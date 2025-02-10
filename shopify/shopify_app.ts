/*
Created by: Henrique Emanoel Viana
Githu: https://github.com/hviana
Page: https://sites.google.com/view/henriqueviana
cel: +55 (41) 99999-4664
*/

import { Context, NextFunc, Server } from "faster";
import * as b64 from "b64";
import { crypto } from "crypto";
import * as hex from "hex";
import { ShopifyAPI } from "./shopify_api.ts";
import { Mutex } from "ts-mutex";

export type WebHookCall = {
  id: string;
  apiVersion: string;
  topic: string;
  shop: string;
  data: any;
};

export type WebHookFunc = (hook: WebHookCall) => Promise<void> | void;

export type UserTokenFunc = (
  shop: string,
  access_token: string,
) => Promise<string> | string;

export type WebHook = {
  topic: string;
  func: WebHookFunc;
  private_metafield_namespaces?: string[];
  metafield_namespaces?: string[];
  fields?: string[];
};

export type ShopifyAppOptions = {
  kv: Deno.Kv;
  api_key: string;
  api_secret: string;
  scopes: string;
  namespace: string;
  host: string;
  home_route: string;
  privacy_policy?: string;
  webhookApiVersion?: string;
  webhooks?: WebHook[];
  userTokenFunc?: UserTokenFunc;
  clientDataFunc?: WebHookFunc;
  deleteClientDataFunc?: WebHookFunc;
  deleteShopDataFunc?: WebHookFunc;
};

const ShopifyAppOptionsDefault = {
  api_key: "",
  api_secret: "",
  scopes: "",
  namespace: "",
  host: "",
  home_route: "",
  privacy_policy: "",
  webhookApiVersion: "2025-04",
  webhooks: [],
  clientDataFunc: async (hook: WebHookCall) => {
  },
  deleteClientDataFunc: async (hook: WebHookCall) => {
  },
  deleteShopDataFunc: async (hook: WebHookCall) => {
  },
};

export class ShopifyApp {
  #enc = new TextEncoder();
  #dec = new TextDecoder();
  #webhooksCreationMutex = new Mutex();
  #server: Server;
  #registered_webhooks: { [key: string]: WebHookFunc } = {};
  #options: ShopifyAppOptions;
  get appPath() {
    return "/" + encodeURIComponent(this.options.namespace!);
  }
  get options() {
    return this.#options;
  }
  constructor(options: ShopifyAppOptions, server: Server) {
    this.#server = server;
    this.#options = { ...ShopifyAppOptionsDefault, ...options };
    this.#mountRoutes();
  }
  #scopesStrToSet(scopes: string) {
    return new Set(scopes.split(",").map((s) => s.trim()));
  }
  async getAccessTokens() {
    var res: any = {};
    const iter = this.#options.kv.list({ prefix: ["shopify_deno"] });
    for await (const shopData of iter) {
      //@ts-ignore
      res[shopData.key[shopData.key.length - 1]] = shopData.value.access_token;
    }
    return res;
  }
  async getAccessToken(shop: string) {
    const data = await this.#geShopData(shop);
    if (data) {
      //@ts-ignore
      return data.access_token;
    }
    return undefined;
  }
  async #geShopData(shop: string) {
    return (await this.#options.kv.get(["shopify_deno", shop])).value;
  }
  async uninstallShop(shop: string) {
    await this.#options.kv.delete(["shopify_deno", shop]);
  }
  async #setShopData(shop: string, data: any) {
    await this.#options.kv.set(["shopify_deno", shop], data);
  }
  async #mountRoutes() {
    var self = this;
    this.#registered_webhooks["client_data"] = this.options.clientDataFunc!;
    this.#registered_webhooks["delete_client"] = this.options
      .deleteClientDataFunc!;
    this.#registered_webhooks["delete_shop"] = this.options.deleteShopDataFunc!;
    for (const w of this.options.webhooks!) {
      this.#registered_webhooks[w.topic] = w.func;
    }
    this.#server.post(
      this.appPath + "/webhooks/*",
      this.#verifyHMAC(),
      async (ctx: Context, next: NextFunc) => {
        try {
          await self.#registered_webhooks[ctx.params.wild](ctx.extra.webhook);
        } catch (e) {
          console.log(
            `Webhook error: ${e}, data: ${JSON.stringify(ctx.extra.webhook)}`,
          );
        }
        await next();
      },
    );
    this.#server.get(
      this.appPath + "/install",
      async (ctx: Context, next: NextFunc) => {
        ctx.res.headers.set(
          "Content-Security-Policy",
          `frame-ancestors https://${
            ctx.url.searchParams.get("shop")
          } https://admin.shopify.com;`,
        );
        const shopData = await self.#geShopData(
          ctx.url.searchParams.get("shop")!,
        );
        var needsInstall = true;
        if (shopData) {
          if (
            //@ts-ignore
            this.#scopesStrToSet(self.options["scopes"]).difference(
              //@ts-ignore
              shopData.scopes,
            ).size == 0
          ) {
            needsInstall = false;
          }
        }
        if (
          (!ctx.url.searchParams.get("session")) ||
          (ctx.url.searchParams.get("session") == "null") ||
          (ctx.url.searchParams.get("session") == null)
        ) {
          needsInstall = true;
        }
        if (needsInstall) {
          const redirect_url = encodeURI(
            `https://${
              self.#dec.decode(
                b64.decodeBase64(ctx.url.searchParams.get("host")!),
              )
            }/oauth/authorize?client_id=${self.options["api_key"]}&scope=${
              self.options["scopes"]
            }&redirect_uri=${
              self.options.host! +
              this.appPath + "/auth"
            }`,
          );
          ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
          ctx.res.body = `<!DOCTYPE html><html><head></head><body>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="width: 100px; position: fixed; top: 50%; left: 50%;"><radialGradient id="a12" cx=".66" fx=".66" cy=".3125" fy=".3125" gradientTransform="scale(1.5)"><stop offset="0" stop-color="#0044FF"></stop><stop offset=".3" stop-color="#0044FF" stop-opacity=".9"></stop><stop offset=".6" stop-color="#0044FF" stop-opacity=".6"></stop><stop offset=".8" stop-color="#0044FF" stop-opacity=".3"></stop><stop offset="1" stop-color="#0044FF" stop-opacity="0"></stop></radialGradient><circle transform-origin="center" fill="none" stroke="url(#a12)" stroke-width="15" stroke-linecap="round" stroke-dasharray="200 1000" stroke-dashoffset="0" cx="100" cy="100" r="70"><animateTransform type="rotate" attributeName="transform" calcMode="spline" dur="2" values="360;0" keyTimes="0;1" keySplines="0 0 1 1" repeatCount="indefinite"></animateTransform></circle><circle transform-origin="center" fill="none" opacity=".2" stroke="#0044FF" stroke-width="15" stroke-linecap="round" cx="100" cy="100" r="70"></circle></svg>
          <script type='text/javascript'>
            if(window !== window.top){
              window.top.location.href = '${redirect_url}';
            }else{
              window.location.href = '${redirect_url}';
            }
              </script></body></html>`;
        } else {
          self.registerWebhooks(ctx.url.searchParams.get("shop")!);
          const redirect_url = encodeURI(`${self.options.host!}${self
            .options.home_route!}?shop=${
            ctx.url.searchParams.get("shop")
          }&session=${
            encodeURIComponent(ctx.url.searchParams.get("session")!)
          }`);
          ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
          ctx.res.body = `<!DOCTYPE html><html><head></head><body>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="width: 100px; position: fixed; top: 50%; left: 50%;"><radialGradient id="a12" cx=".66" fx=".66" cy=".3125" fy=".3125" gradientTransform="scale(1.5)"><stop offset="0" stop-color="#0044FF"></stop><stop offset=".3" stop-color="#0044FF" stop-opacity=".9"></stop><stop offset=".6" stop-color="#0044FF" stop-opacity=".6"></stop><stop offset=".8" stop-color="#0044FF" stop-opacity=".3"></stop><stop offset="1" stop-color="#0044FF" stop-opacity="0"></stop></radialGradient><circle transform-origin="center" fill="none" stroke="url(#a12)" stroke-width="15" stroke-linecap="round" stroke-dasharray="200 1000" stroke-dashoffset="0" cx="100" cy="100" r="70"><animateTransform type="rotate" attributeName="transform" calcMode="spline" dur="2" values="360;0" keyTimes="0;1" keySplines="0 0 1 1" repeatCount="indefinite"></animateTransform></circle><circle transform-origin="center" fill="none" opacity=".2" stroke="#0044FF" stroke-width="15" stroke-linecap="round" cx="100" cy="100" r="70"></circle></svg>
              <script type='text/javascript'>
                  window.location.href = '${redirect_url}';
              </script></body></html>`;
        }

        await next();
      },
    );
    this.#server.get(
      this.appPath + "/auth",
      this.#verifyHMAC(),
      async (ctx: Context, next: NextFunc) => {
        ctx.res.headers.set(
          "Content-Security-Policy",
          `frame-ancestors https://${
            ctx.url.searchParams.get("shop")
          } https://admin.shopify.com;`,
        );
        const shopifyAPI = new ShopifyAPI(ctx.url.searchParams.get("shop")!);
        var res = await shopifyAPI.post("/admin/oauth/access_token", { //offline token, never expires
          client_id: self.options.api_key!,
          client_secret: self.options.api_secret!,
          code: ctx.url.searchParams.get("code"),
        });
        if ((res.http_status === 200) && res.access_token) {
          var scopes = this.#scopesStrToSet(self.options.scopes);
          await this.#setShopData(ctx.url.searchParams.get("shop")!, {
            scopes: scopes,
            code: ctx.url.searchParams.get("code"),
            access_token: res.access_token,
            webhook_topics: new Set(),
          });
          const home_route_embedded = encodeURI(
            `https://${
              self.#dec.decode(
                b64.decodeBase64(ctx.url.searchParams.get("host")!),
              )
            }/apps/${this
              .options.api_key!}${self
              .options.home_route!}?shop=${
              encodeURIComponent(ctx.url.searchParams.get("shop")!)
            }&session=${
              encodeURIComponent(ctx.url.searchParams.get("session")!)
            }`,
          );
          self.registerWebhooks(ctx.url.searchParams.get("shop")!);
          ctx.redirect(home_route_embedded);
        } else {
          ctx.res.status = 403;
        }
        await next();
      },
    );
    this.#server.get(
      this.appPath + "/privacy_policy",
      async (ctx: Context, next: NextFunc) => {
        ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
        ctx.res.body = `<!DOCTYPE html>
          <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Privacy and Terms</title>
            </head>
            <body>
              <pre>${this.options.privacy_policy}</pre>
            </body>
          </html>`;
        await next();
      },
    );
  }
  async registerWebhooks(shop: string) {
    await this.#webhooksCreationMutex.runExclusive(async () => {
      try {
        const shopData = await this.#geShopData(shop);
        var needsUpdate = false;
        const topics = new Set(this.options.webhooks!.map((w) => w.topic));
        if (shopData) { //@ts-ignore
          const hasTopicsDiff1 = topics.difference(shopData.webhook_topics);
          //@ts-ignore
          const hasTopicsDiff2 = shopData.webhook_topics.difference(topics);
          if ((hasTopicsDiff1.size != 0) || (hasTopicsDiff2.size != 0)) {
            needsUpdate = true;
          }
          if (needsUpdate) {
            //@ts-ignore
            const shopifyAPI = new ShopifyAPI(shop, shopData.access_token);
            for (const topic of hasTopicsDiff2) {
              const webHookUrl = encodeURI(
                this.options.host! + this.appPath + "/webhooks/" +
                  topic,
              );
              const exists = await shopifyAPI.get(
                `/admin/api/${this.options.webhookApiVersion}/webhooks.json?address=${webHookUrl}`,
              );
              for (const w of exists.webhooks) {
                const res = await shopifyAPI.delete(
                  `/admin/api/${this.options.webhookApiVersion}/webhooks/${w.id}.json`,
                );
                if (res.http_status != 200) {
                  topics.add(topic);
                }
                console.log(res);
              }
            }
            for (const webHook of this.options.webhooks!) {
              if (hasTopicsDiff1.has(webHook.topic)) {
                const webHookUrl = encodeURI(
                  this.options.host! + this.appPath + "/webhooks/" +
                    webHook.topic,
                );
                this.#registered_webhooks[webHook.topic] = webHook.func;
                const exists = await shopifyAPI.get(
                  `/admin/api/${this.options.webhookApiVersion}/webhooks.json?address=${webHookUrl}`,
                );
                if (exists.webhooks.length < 1) {
                  const data: any = {
                    "webhook": {
                      "topic": webHook.topic,
                      "address": webHookUrl,
                      "format": "json",
                    },
                  };
                  if (webHook.metafield_namespaces) {
                    data.webhook.metafield_namespaces = webHook
                      .metafield_namespaces!;
                  }
                  if (webHook.private_metafield_namespaces) {
                    data.webhook.private_metafield_namespaces = webHook
                      .private_metafield_namespaces!;
                  }
                  if (webHook.fields) {
                    data.webhook.fields = webHook.fields!;
                  }
                  const res = await shopifyAPI.post(
                    `/admin/api/${this.options.webhookApiVersion}/webhooks.json`,
                    data,
                  );
                  if (res.http_status != 201) {
                    topics.delete(webHook.topic);
                  }
                  console.log(res);
                }
              }
            }
            //@ts-ignore
            shopData.webhook_topics = topics;
            await this.#setShopData(shop, shopData);
          }
        }
      } catch (e) {
        console.log(e);
      }
    });
  }
  #verifyHMAC() {
    var self = this;
    return async function verifyHMAC(ctx: Context, next: NextFunc) {
      if (ctx.url.searchParams.get("hmac")) {
        return await self.#verifyAdminHMAC(ctx, next);
      }
      if (ctx.req.headers.get("X-Shopify-Hmac-Sha256")) {
        return await self.#verifyWebhookHMAC(ctx, next);
      }
    };
  }

  async #hmacSha256(secret: string, text: string) {
    const key = await crypto.subtle.importKey(
      "raw",
      this.#enc.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign", "verify"],
    );
    return new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        this.#enc.encode(text),
      ),
    );
  }

  async #verifyWebhookHMAC(ctx: Context, next: NextFunc) {
    const hmac = ctx.req.headers.get("X-Shopify-Hmac-Sha256");
    const topic = ctx.req.headers.get("X-Shopify-Topic");
    const id = ctx.req.headers.get("X-Shopify-Webhook-Id");
    const apiVersion = ctx.req.headers.get("X-Shopify-API-Version");
    const shop = ctx.req.headers.get("X-Shopify-Shop-Domain");
    const message = await ctx.req.text();
    const digest = b64.encodeBase64(
      await this.#hmacSha256(this.options.api_secret!, message),
    );
    if (digest === hmac) {
      ctx.extra.shopify_hmac_verified = true;
      ctx.extra.webhook = <WebHookCall> {
        id: id,
        apiVersion: apiVersion,
        topic: topic,
        shop: shop,
        data: JSON.parse(message),
      };
      await next();
    } else {
      ctx.res.status = 401;
    }
  }

  async #verifyAdminHMAC(ctx: Context, next: NextFunc) {
    const hmac = ctx.url.searchParams.get("hmac");
    var kvpairs: string[] = [];
    ctx.url.searchParams.forEach(function (value: string, key: string) {
      if (key != "hmac" && key != "signature") {
        kvpairs.push(
          encodeURIComponent(key) +
            "=" +
            encodeURIComponent(value),
        );
      }
    });
    const message = kvpairs.sort().join("&");
    const digest = hex.encodeHex(
      await this.#hmacSha256(this.options.api_secret!, message),
    );
    if (digest === hmac) {
      ctx.extra.shopify_hmac_verified = true;
      await next();
    } else {
      ctx.res.status = 401;
    }
  }
}
export default ShopifyApp;
