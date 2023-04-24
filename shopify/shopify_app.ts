/*
Created by: Henrique Emanoel Viana
Githu: https://github.com/hviana
Page: https://sites.google.com/view/henriqueviana
cel: +55 (41) 99999-4664
*/

import { Context, NextFunc, Server } from "../deps.ts";
import { b64, crypto, hex } from "../deps.ts";
import { ShopifyAPI } from "./shopify_api.ts";

export type WebHookCall = {
  id: string;
  apiVersion: string;
  topic: string;
  shop: string;
  data: any;
};

export type WebHookFunc = (data: WebHookCall) => Promise<void> | void;

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
  api_key: string;
  api_secret: string;
  scopes: string;
  namespace: string;
  host: string;
  home_route: string;
  privacy_policy?: string;
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
  webhooks: [],
  userTokenFunc: async (shop: string, access_token: string) => {
    return `${access_token}&shop=${shop}`;
  },
  clientDataFunc: async (data: WebHookCall) => {
  },
  deleteClientDataFunc: async (data: WebHookCall) => {
  },
  deleteShopDataFunc: async (data: WebHookCall) => {
  },
};

export class ShopifyApp {
  static #dec = new TextDecoder("utf-8");
  static #enc = new TextEncoder();
  static #webhookApiVersion = "2022-10";
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
      async (ctx: Context, next) => {
        var redirect_url = encodeURI(
          `https://${
            ctx.url.searchParams.get("shop")
          }/admin/oauth/authorize?client_id=${self.options["api_key"]}&scope=${
            self.options["scopes"]
          }&redirect_uri=${
            self.options.host! +
            this.appPath + "/auth"
          }`,
        );
        ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
        ctx.res.body = `<!DOCTYPE html><html><head></head><body>
		  <strong style="font-size:20pt;">REDIRECTING ...</strong>
		  <script type='text/javascript'>
            if(window !== window.top){
              window.top.location.href = '${redirect_url}';
            }else{
              window.location.href = '${redirect_url}';
            }
          </script></body></html>`;
        await next();
      },
    );
    this.#server.get(
      this.appPath + "/auth",
      this.#verifyHMAC(),
      async (ctx: Context, next: NextFunc) => {
        const shopifyAPI = new ShopifyAPI(ctx.url.searchParams.get("shop")!);
        var res = await shopifyAPI.post("/admin/oauth/access_token", {
          client_id: self.options.api_key!,
          client_secret: self.options.api_secret!,
          code: ctx.url.searchParams.get("code"),
        });
        if (res.http_status === 200) {
          for (var i = 0; i < self.options.webhooks!.length; i++) {
            await self.registerWebhooks(
              ctx.url.searchParams.get("shop")!,
              res.access_token,
              self.options.webhooks![i],
            );
          }
          const token = await self.options.userTokenFunc!(
            ctx.url.searchParams.get("shop")!,
            res.access_token,
          );
          const home_route_abs = encodeURI(
            `${self.options.host!}${self.options.home_route!}?token=${token}`,
          );
          const home_route_embedded = encodeURI(
            `https://${ctx.url.searchParams.get("shop")}/admin/apps/${this
              .options.api_key!}${self
              .options.home_route!}?token=${token}`,
          );
          ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
          ctx.res.body = `<!DOCTYPE html><html><head></head><body>
			<strong style="font-size:20pt;">REDIRECTING ...</strong>
			<script type='text/javascript'>
              window.location.href = (window !== window.top) ? '${home_route_abs}' : '${home_route_embedded}';
            </script></body></html>`;
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
  async registerWebhooks(shop: string, token: string, webHook: WebHook) {
    const shopifyAPI = new ShopifyAPI(shop, token);
    const webHookUrl = encodeURI(
      this.options.host! + this.appPath + "/webhooks/" +
        webHook.topic,
    );
    this.#registered_webhooks[webHook.topic] = webHook.func;
    const exists = await shopifyAPI.get(
      `/admin/api/${ShopifyApp.#webhookApiVersion}/webhooks.json?address=${webHookUrl}`,
    );
    if (exists.webhooks.length > 0) {
      return;
    }
    const data: any = {
      "webhook": {
        "topic": webHook.topic,
        "address": webHookUrl,
        "format": "json",
      },
    };
    if (webHook.metafield_namespaces) {
      data.webhook.metafield_namespaces = webHook.metafield_namespaces!;
    }
    if (webHook.private_metafield_namespaces) {
      data.webhook.private_metafield_namespaces = webHook
        .private_metafield_namespaces!;
    }
    if (webHook.fields) {
      data.webhook.fields = webHook.fields!;
    }
    const res = await shopifyAPI.post(
      `/admin/api/${ShopifyApp.#webhookApiVersion}/webhooks.json`,
      data,
    );
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
      ShopifyApp.#enc.encode(secret),
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
        ShopifyApp.#enc.encode(text),
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
    const digest = b64.encode(
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
    const digest = ShopifyApp.#dec.decode(
      hex.encode(await this.#hmacSha256(this.options.api_secret!, message)),
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
