/*
Created by: Henrique Emanoel Viana
Githu: https://github.com/hviana
Page: https://sites.google.com/site/henriqueemanoelviana
cel: +55 (41) 99999-4664
*/

export class ShopifyAPI {
  #shop: string;
  #token: string;
  #apiVersion: string;
  #apiKey: string;
  static #tagSep = ", ";
  constructor(
    shop: string,
    token: string = "",
    apiKey: string = "",
    apiVersion: string = "2022-01",
  ) {
    this.#shop = shop;
    this.#token = token;
    this.#apiKey = apiKey;
    this.#apiVersion = apiVersion;
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
    var request = await fetch(
      `https://${this.#shop}/${endpoint}`,
      params,
    );
    var res: any = {};
    try {
      res = await request.json();
    } catch (e) {}
    if (
      request.status === 429 ||
      (res.errors && res.errors[0] && res.errors[0].extensions &&
        res.errors[0].extensions.code === "THROTTLED")
    ) {
      await this.delay(1000);
      return await this.request(endpoint, method, data);
    }
    return { ...res, ...{ http_status: request.status } };
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
    var request = await fetch(
      `https://${this.#shop}/${endpoint}`,
      {
        method: "POST",
        headers: headers,
        body: query,
      },
    );
    const res: any = await request.json();
    if (
      request.status === 429 ||
      (res.errors && res.errors[0].extensions.code === "THROTTLED")
    ) {
      await this.delay(1000);
      return await this.graphQL(query, endpoint);
    }
    return { ...res, ...{ http_status: request.status } };
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
          tags.indexOf(data.data.products.edges[i].node.tags[j]) === -1 &&
          data.data.products.edges[i].node.tags[j].toLowerCase().includes(
            search.toLowerCase(),
          )
        ) {
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

  async getOrders(
    created_at_min: string,
    created_at_max: string = (new Date()).toISOString(),
    limit: number = 50,
    status: string = "any",
    financial_status: string = "any",
    fulfillment_status: string = "any",
    cursor: any = null,
  ) {
    const res = (await this.graphQL(`
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
    `));
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
  async createPlan(name: string, price: number, trialDays: number = 0) {
    const res = await this.post(
      `/admin/api/${this.#apiVersion}/recurring_application_charges.json`,
      {
        "recurring_application_charge": {
          name: name,
          price: price,
          return_url: this.appUrl,
          trial_days: trialDays,
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
