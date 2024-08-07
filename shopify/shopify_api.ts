/*
Created by: Henrique Emanoel Viana
Githu: https://github.com/hviana
Page: https://sites.google.com/view/henriqueviana
cel: +55 (41) 99999-4664
*/

export class ShopifyAPI {
  #shop: string;
  #token: string;
  #apiVersion: string;
  #apiKey: string;
  #maxReqsPerSecond: { [key: string]: number } = {};
  static maxOrderNoteAttrLen: number = 65000;
  static #cleaningReqs: { [key: string]: boolean } = {};
  static #cleaningGraphQL: { [key: string]: boolean } = {};
  static #lastReq: { [key: string]: number } = {};
  static #tagSep = ", ";
  static #graphQlThrottleStatus: { [key: string]: any } = {};
  static #reqsPerSecond: { [key: string]: number } = {};
  static #quantityNames = [
    "reserved",
    "committed",
    "available",
    "on_hand",
  ];
  constructor(
    shop: string,
    token: string = "",
    apiKey: string = "",
    apiVersion: string = "2024-07",
    maxReqsPerSecond: number = 2,
  ) {
    this.#shop = shop;
    ShopifyAPI.#graphQlThrottleStatus[this.#shop] = {};
    ShopifyAPI.#reqsPerSecond[this.#shop] = 0;
    ShopifyAPI.#lastReq[this.#shop] = Date.now();
    ShopifyAPI.#cleaningReqs[this.#shop] = false;
    ShopifyAPI.#cleaningGraphQL[this.#shop] = false;
    this.#token = token;
    this.#apiKey = apiKey;
    this.#apiVersion = apiVersion;
    this.#maxReqsPerSecond[this.#shop] = maxReqsPerSecond;
  }
  async get(endpoint: string) {
    return await this.request(endpoint, "GET", null);
  }
  async put(endpoint: string, data: any = {}) {
    return await this.request(endpoint, "PUT", data);
  }
  async post(endpoint: string, data: any = {}) {
    return await this.request(endpoint, "POST", data);
  }
  async delete(endpoint: string, data: any = {}) {
    return await this.request(endpoint, "DELETE", data);
  }

  delay(ms: number): Promise<void> {
    return new Promise((res): number =>
      setTimeout((): void => {
        res();
      }, ms)
    );
  }

  cleanSearch(search: string): string {
    return search.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  }
  async delayQueueGraphQl() {
    while (ShopifyAPI.#cleaningGraphQL[this.#shop]) {
      await this.delay(100);
    }
    var cleaned = false;
    if (ShopifyAPI.#graphQlThrottleStatus[this.#shop].maximumAvailable) {
      if (
        ShopifyAPI.#graphQlThrottleStatus[this.#shop].currentlyAvailable <=
          ShopifyAPI.#graphQlThrottleStatus[this.#shop].restoreRate
      ) {
        ShopifyAPI.#cleaningGraphQL[this.#shop] = true;
        await this.delay(
          1000 *
            Math.ceil(
              ShopifyAPI.#graphQlThrottleStatus[this.#shop].maximumAvailable /
                ShopifyAPI.#graphQlThrottleStatus[this.#shop].restoreRate,
            ),
        );
        cleaned = true;
        ShopifyAPI.#cleaningGraphQL[this.#shop] = false;
      }
    }

    return cleaned;
  }
  async delayQueue() {
    while (ShopifyAPI.#cleaningReqs[this.#shop]) {
      await this.delay(100);
    }
    var cleaned = false;
    if (
      ShopifyAPI.#reqsPerSecond[this.#shop] >=
        this.#maxReqsPerSecond[this.#shop]
    ) {
      ShopifyAPI.#cleaningReqs[this.#shop] = true;
      await this.delay(1000 - (Date.now() - ShopifyAPI.#lastReq[this.#shop]));
      ShopifyAPI.#reqsPerSecond[this.#shop] = 0;
      cleaned = true;
      ShopifyAPI.#cleaningReqs[this.#shop] = false;
    }
    return cleaned;
  }
  async request(
    endpoint: string,
    method: string = "GET",
    data: any = {},
  ): Promise<any> {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Accept": "application/json",
    });
    if (this.#token) {
      headers.append("X-Shopify-Access-Token", this.#token);
    }
    const reqData = JSON.stringify(data);
    var params: any = {
      method: method,
      headers: headers,
    };
    if (method !== "GET" && method !== "HEAD") {
      params.body = reqData;
    }
    if (!endpoint.startsWith("http")) {
      endpoint = `https://${this.#shop}/${endpoint}`;
    }
    const cleaned = await this.delayQueue();
    if (((Date.now() - ShopifyAPI.#lastReq[this.#shop]) < 1000) || cleaned) {
      ShopifyAPI.#reqsPerSecond[this.#shop]++;
    } else {
      ShopifyAPI.#lastReq[this.#shop] = Date.now();
    }
    try {
      var res: any = {};
      var request: any = {};
      request = await fetch(
        endpoint,
        params,
      );
      res = await request.json();
    } catch (e) {
      console.log(e);
    }
    if (
      //@ts-ignore
      request.status === 429 ||
      (res.errors && res.errors[0] && res.errors[0].extensions &&
        res.errors[0].extensions.code === "THROTTLED")
    ) {
      await this.delay(1000);
      return await this.request(endpoint, method, data);
    }
    const retData = {
      ...res,
      ...{ //@ts-ignore
        http_status: request.status, //@ts-ignore
        headers: Object.fromEntries(request.headers || []),
      },
    };
    if (retData.headers.link) {
      const links: string[] = [];
      const index = retData.headers.link.indexOf(", <https");
      if (index > 0) {
        links.push(retData.headers.link.substring(0, index));
        links.push(retData.headers.link.substring(index + 2));
      } else {
        links.push(retData.headers.link);
      }
      for (const l of links) {
        if (l.includes('rel="next"')) {
          retData.next_page = l.match(/<(.*)>; rel="next"/)![1];
        } else if (l.includes('rel="previous"')) {
          retData.previous_page = l.match(/<(.*)>; rel="previous"/)![1];
        }
      }
    }
    return retData;
  }

  async graphQL(
    query: string,
    endpoint: string = `admin/api/${this.#apiVersion}/graphql.json`,
  ): Promise<any> {
    const headers = new Headers({
      "Content-Type": "application/graphql",
      "Accept": "application/json",
      "Content-Length": query.length.toString(),
    });
    if (this.#token) {
      headers.append("X-Shopify-Access-Token", this.#token);
    }
    const cleaned = await this.delayQueueGraphQl();
    try {
      var res: any = {};
      var request: any = {};
      request = await fetch(
        `https://${this.#shop}/${endpoint}`,
        {
          method: "POST",
          headers: headers,
          body: query,
        },
      );

      res = await request.json();
    } catch (e) {
      console.log(e);
    }
    if (
      res.extensions && res.extensions.cost &&
      res.extensions.cost.throttleStatus
    ) {
      ShopifyAPI.#graphQlThrottleStatus[this.#shop] =
        res.extensions.cost.throttleStatus;
    }
    if (
      //@ts-ignore
      request.status === 429 ||
      (res.errors && res.errors[0] && res.errors[0].extensions &&
        res.errors[0].extensions.code === "THROTTLED")
    ) {
      await this.delay(1000);
      return await this.graphQL(query, endpoint);
    }
    return {
      ...res,
      ...{ //@ts-ignore
        http_status: request.status, //@ts-ignore
        headers: Object.fromEntries(request.headers || []),
      },
    };
  }
  async searchTags(search: string, limit: number = 20): Promise<string[]> {
    search = this.cleanSearch(search);
    const tags = [];
    const data = await this.graphQL(`
    {
        products(first: ${limit}, query:"tag:*(${search})*"){
          edges{
            node {
              tags
            }
          }
        }
    }
    `);
    for (const i in data.data.products.edges) {
      for (const j in data.data.products.edges[i].node.tags) {
        if (
          //@ts-ignore
          tags.indexOf(data.data.products.edges[i].node.tags[j]) === -1 &&
          data.data.products.edges[i].node.tags[j].toLowerCase().includes(
            search.toLowerCase(),
          )
        ) { //@ts-ignore
          tags.push(data.data.products.edges[i].node.tags[j]);
        }
      }
    }
    return tags;
  }
  async includeScripts(
    appScripts: string[],
    cache: boolean = false,
    update: boolean = false,
  ) {
    const storeScripts = await this.get(
      `/admin/api/${this.#apiVersion}/script_tags.json`,
    );
    var toInstall = [...appScripts];
    var toUpdateScripts: any[] = [];
    for (const appScript of appScripts) {
      for (const storeScript of storeScripts.script_tags) {
        if (storeScript.src.includes(encodeURI(appScript))) {
          toInstall.splice(toInstall.indexOf(appScript), 1);
          toUpdateScripts.push({
            id: storeScript.id,
            src: appScript,
          });
        }
      }
    }
    if (!update) {
      for (const installScript of toInstall) {
        await this.post(`/admin/api/${this.#apiVersion}/script_tags.json`, {
          "script_tag": {
            "event": "onload",
            "src": encodeURI(installScript),
            "cache": cache,
          },
        });
      }
    } else {
      for (const updateScript of toUpdateScripts) {
        await this.put(
          `/admin/api/${this.#apiVersion}/script_tags/${updateScript.id}.json`,
          {
            "script_tag": {
              "id": updateScript.id,
              "src": encodeURI(updateScript.src) +
                (encodeURI(updateScript.src).includes("?")
                  ? "&scriptTime="
                  : "?scriptTime=") +
                Date.now().toString(),
              "cache": cache,
            },
          },
        );
      }
    }
  }

  async listChannels(): Promise<any> {
    return (await this.graphQL(`
    {
      publications(first:250){
        edges{
          node{
            id
            name
          }
        }
      }
    }
  `)).data.publications.edges.map((n) => n.node);
  }

  async publish(objGid: string, publicationGid: string): Promise<any> {
    return await this.graphQL(`
    mutation {
      publishablePublish(id: "${objGid}", input:{
        publicationId: "${publicationGid}",
        publishDate: "${(new Date()).toISOString()}"
      }){
        userErrors {
          field
          message
        }
      }
    }
  `);
  }

  async unPublish(objGid: string, publicationGid: string): Promise<any> {
    return await this.graphQL(`
    mutation {
      publishableUnpublish(id: "${objGid}", input:{
        publicationId: "${publicationGid}",
        publishDate: "${(new Date()).toISOString()}"
      }){
        userErrors {
          field
          message
        }
      }
    }
  `);
  }

  async productCreateMedia(
    imageSourceUrls: string[],
    productId: string,
    mediaContentType: string = "IMAGE",
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const url of imageSourceUrls) {
      const resMedia = await this.graphQL(`
      mutation {
        productCreateMedia(media: {
          mediaContentType: ${mediaContentType},
          originalSource: "${url}"
        },
        productId: "gid://shopify/Product/${productId}"
        ) {
          media {
            id
          }
        }
      }
      `);
      var idParts = resMedia.data.productCreateMedia.media[0].id.split("/");
      ids.push(idParts[idParts.length - 1]);
    }
    return ids;
  }
  async productVariantAppendMedia(
    mediaIds: string[],
    productId: string,
    variantId: string,
  ) {
    const mediaIdsUrls = mediaIds.map((id) => `gid://shopify/MediaImage/${id}`);
    var res: any[] = [];
    for (const mediaIdsUrl of mediaIdsUrls) {
      res.push(
        await this.graphQL(`
      mutation {
        productVariantAppendMedia(productId: "gid://shopify/Product/${productId}", 
          variantMedia: [{
            mediaIds: ["${mediaIdsUrl}"],
            variantId: "gid://shopify/ProductVariant/${variantId}"
          }]
        ){
            userErrors {
              code
              field
              message
            }
          }
      }
      `),
      );
    }
    return res;
  }

  async getOrders(
    created_at_min: string,
    created_at_max: string = (new Date()).toISOString(),
    limit: number = 50,
    status: string = "any",
    financial_status: string = "any",
    fulfillment_status: string = "any",
    cursor: any = null,
  ) {
    const res = await this.graphQL(`
    query {
      orders(first: ${limit}, ${
      cursor ? `after:"${cursor}", ` : ""
    } query: "created_at:>=${created_at_min} created_at:<=${created_at_max} financial_status:${financial_status} fulfillment_status:${fulfillment_status} status:${status}" ) {
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
        edges {
          cursor
          node {
              name
              app {
                name
              }
              currentSubtotalLineItemsQuantity
              displayFinancialStatus
              displayFulfillmentStatus
              processedAt
              cancelledAt
              email
              phone
              customer {
                email
                phone
              }
              shippingAddress {
                phone
              }
              shippingLine {
                title
                discountedPriceSet {
                  presentmentMoney {
                      amount
                      currencyCode
                    }
                    shopMoney {
                      amount
                      currencyCode
                    }
                }
              }
              tags
              discountCode
              currentTotalPriceSet {
                presentmentMoney {
                  amount
                  currencyCode
                }
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentTotalTaxSet {
                presentmentMoney {
                  amount
                  currencyCode
                }
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentTotalDiscountsSet {
                presentmentMoney {
                  amount
                  currencyCode
                }
                shopMoney {
                  amount
                  currencyCode
                }
              }
              customerJourneySummary {
                customerOrderIndex
                daysToConversion
                firstVisit {
                    landingPage 
                    landingPageHtml
                    marketingEvent {
                      app {
                        title
                      }
                      channel
                      type
                      utmCampaign
                      utmMedium
                      utmSource
                    }
                    occurredAt
                    referralCode
                    referralInfoHtml
                    referrerUrl
                    source 
                    sourceDescription 
                    sourceType
                    utmParameters {
                      campaign
                      content
                      medium
                      source
                      term
                    } 
                }
                lastVisit {
                  landingPage 
                  landingPageHtml
                  marketingEvent {
                    app {
                      title
                    }
                    channel
                    type
                    utmCampaign
                    utmMedium
                    utmSource
                  }
                  occurredAt
                  referralCode
                  referralInfoHtml
                  referrerUrl
                  source 
                  sourceDescription 
                  sourceType
                  utmParameters {
                    campaign
                    content
                    medium
                    source
                    term
                  } 
                }
                momentsCount
                ready 
            }
          }
        }
      }
    }
    `);
    const allData: any[] = res.data.orders.edges;
    if (res.data.orders.pageInfo.hasNextPage) {
      allData.push(
        ...await this.getOrders(
          created_at_min,
          created_at_max,
          limit,
          status,
          financial_status,
          fulfillment_status,
          res.data.orders.edges[res.data.orders.edges.length - 1]
            .cursor,
        ),
      );
    }
    return allData;
  }

  async tagsAdd(objectName: string, id: string, tags: string[]): Promise<any> {
    return await this.graphQL(`
      mutation {
        tagsAdd (
          id: "gid://shopify/${objectName}/${id}",
          tags: ${JSON.stringify(tags)}
          ) {
            userErrors {
              field
              message
            }
          }
      }
  `);
  }
  async tagsRemove(
    objectName: string,
    id: string,
    tags: string[],
  ): Promise<any> {
    return await this.graphQL(`
      mutation {
        tagsRemove (
          id: "gid://shopify/${objectName}/${id}",
          tags: ${JSON.stringify(tags)}
          ) {
            userErrors {
              field
              message
            }
          }
      }
  `);
  }

  async searchProductsByTitle(search: string, limit: number = 10) {
    search = this.cleanSearch(search);
    const resQuery = await this.graphQL(`
    {
      products(first: ${limit}, query: "*(${search})*") {
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
        edges {
          cursor
          node {
            id
            title
            featuredImage {
              transformedSrc
            }
          }
        }
      }
    }
    `);
    const res: any[] = [];
    for (const p of resQuery.data.products.edges) {
      res.push({
        id: p.node.id.split("/").pop(),
        title: p.node.title,
        img: p.node.featuredImage.transformedSrc,
      });
    }
    return res;
  }

  async getAllProductsByIds(ids: string[]): Promise<any[]> {
    var res: any[] = [];
    for (const id of ids) {
      res.push(
        (await this.get(`/admin/api/${this.#apiVersion}/products/${id}.json`))
          .product,
      );
    }
    return res;
  }
  async getAllProductsIdsByTags(tags: string[]) {
    var res: string[] = [];
    for (const t of tags) {
      res.push(...await this.getAllProductsIdsByTag(t));
    }
    return [...new Set(res)];
  }

  async getAllProductsIdsByTag(
    tag: string,
    numItems: number = 250,
    cursor: any = null,
  ): Promise<string[]> { //query:"sku:1*"
    const resQuery = await this.graphQL(`query {
      products(first:${numItems}, ${
      cursor ? `after:"${cursor}", ` : ""
    } query:"tag:${tag}") {
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
        edges {
          cursor
          node {
            id
          }
        }
      }
    }`);
    if (!resQuery.data) {
      return await this.getAllProductsIdsByTag(tag, numItems, cursor);
    }
    const res: string[] = [];
    for (const p of resQuery.data.products.edges) {
      res.push(p.node.id.split("/").pop());
    }
    if (resQuery.data.products.pageInfo.hasNextPage) {
      res.push(
        ...await this.getAllProductsIdsByTag(
          tag,
          numItems,
          resQuery.data.products.edges[resQuery.data.products.edges.length - 1]
            .cursor,
        ),
      );
    }
    return res;
  }

  async getProductIdBySKU(SKU: string) { //query:"sku:1*"
    const data = await this.graphQL(`
    {
      products(first:1, query:"sku:${SKU}") {
        edges {
          node {
            id
          }
        }
      }
    }
    `);
    return data.data.products.edges[0].node.id.split("/").pop();
  }
  async getPlans() {
    const res = await this.get(
      `/admin/api/${this.#apiVersion}/recurring_application_charges.json`,
    );
    return res.recurring_application_charges;
  }
  async createPlan(
    name: string,
    price: number,
    trialDays: number = 0,
    test: boolean | null = null,
  ) {
    const res = await this.post(
      `/admin/api/${this.#apiVersion}/recurring_application_charges.json`,
      {
        "recurring_application_charge": {
          name: name,
          price: price,
          return_url: this.appUrl,
          trial_days: trialDays,
          test: test,
        },
      },
    );
    return res.recurring_application_charge;
  }
  async getPlanStatus(planId: string) {
    const res = await this.get(
      `/admin/api/${this.#apiVersion}/recurring_application_charges/${planId}.json`,
    );
    return res.recurring_application_charge.status;
  }
  async getPlanUrl(planId: string) {
    const res = await this.get(
      `/admin/api/${this.#apiVersion}/recurring_application_charges/${planId}.json`,
    );
    return res.recurring_application_charge.confirmation_url;
  }
  get appUrl() {
    if (!this.#apiKey) {
      throw new Error(
        "For generate app url, needs apiKey parameter pass to constructor",
      );
    }
    return `https://${this.#shop}/admin/apps/${this.#apiKey}`;
  }
  async getAllProducts(): Promise<any[]> {
    const products: any[] = [];
    await this.walkOnProducts((p: any) => products.push(p));
    return products;
  }
  async getAllInventories(locationId: string): Promise<any[]> {
    const inventories: any[] = [];
    await this.walkOnInventories(locationId, (i: any) => inventories.push(i));
    return inventories;
  }
  async getProduct(id: string | number) {
    return (await this.get(`admin/api/${this.#apiVersion}/products/${id}.json`))
      .product;
  }
  async deleteProductTag(tag: string) {
    const productsIds = await this.getAllProductsIdsByTag(tag);
    for (const id of productsIds) {
      const p = await this.getProduct(id);
      await this.removeProductTag(p.id, p.tags, [tag]);
    }
  }
  async getCollectionIdByHandle(handle: string) {
    return (await this.graphQL(`
    query {
       collectionByHandle(handle: "${handle}") {
          id
       } 
    }
    `)).data.collectionByHandle.id.split("/").pop();
  }
  async getAllCollectsInCollection(collectionId: string | number) {
    const max: number = 250;
    var since: number = 0;
    var data: any = {};
    const res: any[] = [];
    while (
      (data = await this.get(
        `/admin/api/${this.#apiVersion}/collects.json?collection_id=${collectionId}&limit=${max}&since_id=${since}`,
      )).collects.length > 0
    ) {
      since = data.collects[data.collects.length - 1].id;
      res.push(...data.collects);
    }
    return res;
  }

  async getAllProductsInCollection(collectionId: string | number) {
    const max: number = 250;
    var since: number = 0;
    var data: any = {};
    const res: any[] = [];
    while (
      (data = await this.get(
        `/admin/api/${this.#apiVersion}/collections/${collectionId}/products.json?limit=${max}&since_id=${since}`,
      )).products.length > 0
    ) {
      since = data.products[data.products.length - 1].id;
      res.push(...data.products);
    }
    return res;
  }
  async walkOnInventories(
    locationId: string,
    func: (inventory: any) => any | Promise<any>,
  ): Promise<void> {
    const max: number = 250;
    var link =
      `/admin/api/${this.#apiVersion}/locations/${locationId}/inventory_levels.json?limit=${max}`;
    while (
      link
    ) {
      const data = await this.get(link);
      for (const inventory of data.inventory_levels) {
        await func(inventory);
      }
      link = data.next_page;
    }
  }
  async walkOnProducts(
    func: (product: any) => any | Promise<any>,
  ): Promise<void> {
    const max: number = 250;
    var since: number = 0;
    var data: any = {};
    while (
      (data = await this.get(
        `/admin/api/${this.#apiVersion}/products.json?limit=${max}&since_id=${since}`,
      )).products.length > 0
    ) {
      since = data.products[data.products.length - 1].id;
      for (const p of data.products) {
        await func(p);
      }
    }
  }
  async walkOnDraftOrders(
    func: (product: any) => any | Promise<any>,
  ): Promise<void> {
    const max: number = 250;
    var since: number = 0;
    var data: any = {};
    while (
      (data = await this.get(
        `/admin/api/${this.#apiVersion}/draft_orders.json?limit=${max}&since_id=${since}`,
      )).draft_orders.length > 0
    ) {
      since = data.draft_orders[data.draft_orders.length - 1].id;
      for (const p of data.draft_orders) {
        await func(p);
      }
    }
  }
  async addProductTag(id: number, currentTags: string, tags: string[]) {
    var tagsArr: string[] = currentTags.split(ShopifyAPI.#tagSep);
    tagsArr.push(...tags);
    tagsArr = [...new Set(tagsArr)];
    await this.put(`/admin/api/${this.#apiVersion}/products/${id}.json`, {
      product: {
        id: id,
        tags: tagsArr.join(ShopifyAPI.#tagSep),
      },
    });
  }
  async deleteAllCollects(collectionId: string | number) {
    const collects = await this.getAllCollectsInCollection(collectionId);
    for (const c of collects) {
      await this.delete(`/admin/api/${this.#apiVersion}/collects/${c.id}.json`);
    }
  }
  async putCollectsInOrder(
    collectionId: string | number,
    productsIds: (string | number)[],
  ) {
    for (var i = 1; i < productsIds.length + 1; i++) {
      const productId = productsIds[i - 1];
      await this.post(`/admin/api/${this.#apiVersion}/collects.json`, {
        collect: {
          collection_id: collectionId,
          product_id: productId,
          position: i,
          sort_value: i.toString().padStart(10, "0"),
        },
      });
    }
  }
  async putProductsInOrder(
    collectionId: string | number,
    productsIds: (string | number)[],
  ) {
    const maxLength = 8192;
    const initLength =
      `/admin/api/${this.#apiVersion}/smart_collections/${collectionId}/order.json?`
        .length;
    const partLength = `products[]=${productsIds[0]}&`.length;
    var partQuery: string[] = [];
    for (const pId of productsIds) {
      if ((initLength + partLength * (partQuery.length + 1)) > maxLength) {
        break;
      } else {
        partQuery.push(`products[]=${pId}`);
      }
    }
    await this.put(
      `/admin/api/${this.#apiVersion}/smart_collections/${collectionId}/order.json?${
        partQuery.join("&")
      }`,
    );
  }
  async isSmartCollection(collectionId: string | number): Promise<boolean> {
    var isSmart = false;
    try {
      var collection = (await this.get(
        `/admin/api/${this.#apiVersion}/smart_collections/${collectionId}.json`,
      )).smart_collection;
      if (collection) {
        isSmart = true;
      }
    } catch (e) {
    }
    return isSmart;
  }
  async getInventoryLevelsBySKU(
    sku: string | number,
  ) {
    const res = await this.graphQL(`
  query {
    productVariants(first: 1, query: "sku:${sku}") {
      edges{
        node {
          inventoryItem {
            inventoryLevels(first:249) {
               edges {
                  node {
                    location {
                        id
                    },
                  quantities(names: ${
      JSON.stringify(ShopifyAPI.#quantityNames)
    })        {
                              name
                              quantity
                            }
                  }
                }
            }
          }
        }
      }
    }
  }`);
    return res.data.productVariants.edges[0].node.inventoryItem.inventoryLevels
      .edges;
  }
  async getInventoryLevelBySKU(
    sku: string | number,
    locationId: string | number,
  ) {
    const res = await this.graphQL(`
    query {
      productVariants(first: 1, query: "sku:${sku}") {
        edges{
          node {
            inventoryItem {
              inventoryLevel(locationId: "gid://shopify/Location/${locationId}") {
                quantities(names: ${
      JSON.stringify(ShopifyAPI.#quantityNames)
    }) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  `);
    return res.data.productVariants.edges[0].node.inventoryItem.inventoryLevel;
  }
  async getAllProductInventoryLevels(
    locationId: string | number,
    productGid: string | number,
    variantCursor: any = null,
  ) {
    const variantQty = 100;
    const resQuery = await this.graphQL(`
    query {
      product(id:"${productGid}") {
        id
        variants(first: ${variantQty}${
      variantCursor ? `, after:"${variantCursor}"` : ""
    }){
          pageInfo {
            hasNextPage
          }
          edges{
            cursor
            node {
              id
              sku
              inventoryItem {
                inventoryLevel(locationId: "gid://shopify/Location/${locationId}") {
                  available
                  quantities(names: ${
      JSON.stringify(ShopifyAPI.#quantityNames)
    }) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }
    `);
    const res: any[] = resQuery.data.product.variants.edges;
    if (resQuery.data.product.variants.pageInfo.hasNextPage) {
      res.push(
        ...await this.getAllProductInventoryLevels(
          locationId,
          productGid,
          resQuery.data.product.variants
            .edges[resQuery.data.product.variants.edges.length - 1]
            .cursor,
        ),
      );
    }
    return res;
  }
  async getAllInventoryLevels(
    locationId: string | number,
    productCursor: any = null,
    published: boolean = true,
    average: number = -1,
  ): Promise<any> {
    if (average < 0) {
      average = await this.averageVariantsPerProduct(published);
    }
    const variantQty = average;
    const productQty = Math.floor(240 / variantQty);
    const resQuery = await this.graphQL(`
    query {
      products(first: ${productQty}${
      productCursor ? `, after:"${productCursor}"` : ""
    }${published ? `, query: "published_status:published"` : ""}) {
        pageInfo {
          hasNextPage
        }
        edges{
          cursor
          node {
            id
            variants(first: ${variantQty}) {
              pageInfo {
                hasNextPage
              }
              edges{
                cursor
                node {
                  id
                  sku
                  inventoryItem {
                    inventoryLevel(locationId: "gid://shopify/Location/${locationId}") {
                      available
                      quantities(names: ${
      JSON.stringify(ShopifyAPI.#quantityNames)
    }) {
                        name
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `);
    for (const e of resQuery.data.products.edges) {
      if (e.node.variants.pageInfo.hasNextPage) {
        e.node.variants.edges.push(
          ...await this.getAllProductInventoryLevels(
            locationId,
            e.node.id,
            e.node.variants.edges[e.node.variants.edges.length - 1]
              .cursor,
          ),
        );
      }
    }
    const res: any[] = [];
    for (const p of resQuery.data.products.edges) {
      res.push(p.node);
    }
    if (resQuery.data.products.pageInfo.hasNextPage) {
      res.push(
        ...await this.getAllInventoryLevels(
          locationId,
          resQuery.data.products.edges[resQuery.data.products.edges.length - 1]
            .cursor,
          published,
          average,
        ),
      );
    }
    return res;
  }
  #average(arr: number[]): number {
    var sum = 0;
    for (var number of arr) {
      sum += number;
    }
    const average = sum / arr.length;
    return average;
  }
  async averageVariantsPerProduct(published: boolean = true): Promise<number> {
    const products = await this.getAllProducts();
    const values: any[] = [];
    for (const p of products) {
      if (!published || (published && p.published_at)) {
        if (p.variants) {
          values.push(p.variants.length);
        }
      }
    }
    return Math.ceil(this.#average(values));
  }
  async removeProductTag(id: number, currentTags: string, tags: string[]) {
    const tagsArr: string[] = currentTags.split(ShopifyAPI.#tagSep);
    for (const t of tags) {
      var i = tagsArr.length;
      while (i--) {
        if (tagsArr[i] === t) {
          tagsArr.splice(i, 1);
          break;
        }
      }
    }
    await this.put(`/admin/api/${this.#apiVersion}/products/${id}.json`, {
      product: {
        id: id,
        tags: tagsArr.join(ShopifyAPI.#tagSep),
      },
    });
  }
}
