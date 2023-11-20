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
  // deno-lint-ignore no-explicit-any
  data: any;
};

export type WebHookFunc = (ctx:Context, data: WebHookCall) => Promise<void> | void;

export type UserTokenFunc = (
  ctx: Context,
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
  policy_route: string;
  webhooks?: WebHook[];
  embeded?: boolean;
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
  home_route: "/",
  policy_route: "/privacy_policy",
  embeded: true,
  webhooks: [],
  userTokenFunc: (_ctx: Context, shop: string, access_token: string) => {
    return `${access_token}&shop=${shop}`;
  },
  clientDataFunc: async (_ctx:Context, _data: WebHookCall) => {
  },
  deleteClientDataFunc: async (_ctx:Context, _data: WebHookCall) => {
  },
  deleteShopDataFunc: async (_ctx:Context, _data: WebHookCall) => {
  },
};

export class ShopifyApp {
  static #dec = new TextDecoder("utf-8");
  static #enc = new TextEncoder();
  static #webhookApiVersion = "2023-10";
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
  #mountRoutes() {
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
          await this.#registered_webhooks[ctx.params.wild](ctx, ctx.extra.webhook);
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
        const redirect_url = encodeURI(
          `https://${
            ctx.url.searchParams.get("shop")
          }/admin/oauth/authorize?client_id=${this.options["api_key"]}&scope=${
            this.options["scopes"]
          }&redirect_uri=${
            this.options.host! +
            this.appPath + "/auth"
          }`,
        );
        ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
        ctx.res.body = `<!DOCTYPE html>
        <html>
          <head></head>
          <body>
            <strong style="font-size:14px;">redirecting to shopify...</strong>
            <script type='text/javascript'>
              if(window !== window.top){
                window.top.location.href = '${redirect_url}';
              }else{
                window.location.href = '${redirect_url}';
              }
            </script>
          </body>
        </html>`;
        await next();
      },
    );
    this.#server.get(
      this.appPath + "/auth",
      this.#verifyHMAC(),
      async (ctx: Context, next: NextFunc) => {
        const shopifyAPI = new ShopifyAPI(ctx.url.searchParams.get("shop")!);
        const res = await shopifyAPI.post("/admin/oauth/access_token", {
          client_id: this.options.api_key!,
          client_secret: this.options.api_secret!,
          code: ctx.url.searchParams.get("code"),
        });
        if (res.http_status === 200) {
          for (let i = 0; i < this.options.webhooks!.length; i++) {
            await this.registerWebhooks(
              ctx.url.searchParams.get("shop")!,
              res.access_token,
              this.options.webhooks![i],
            );
          }
          const token = await this.options.userTokenFunc!(
            ctx,
            ctx.url.searchParams.get("shop")!,
            res.access_token,
          );
          const home_route_abs = encodeURI(
            `${this.options.host!}${this.options.home_route!}?token=${token}`,
          );
          const home_route_embedded = encodeURI(
            `https://${ctx.url.searchParams.get("shop")}/admin/apps/${this.options.api_key!}${this.options.home_route!}?token=${token}`,
          );
          // redirect to home page
          if(!this.options.embeded) ctx.redirect(home_route_abs)
          else {
            ctx.res.headers.append("Content-Type", "text/html; charset=utf-8");
            ctx.res.body = `<!DOCTYPE html>
              <html>
                <head></head>
                <body>
                  <strong style="font-size:14px;">redirecting ...</strong>
                  <script type='text/javascript'>
                    window.location.href = (window !== window.top) ? '${home_route_abs}' : '${home_route_embedded}';
                  </script>
                </body>
              </html>`;
          }
        } else {
          ctx.res.status = 403;
        }
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
    // deno-lint-ignore no-explicit-any
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
    const _res = await shopifyAPI.post(
      `/admin/api/${ShopifyApp.#webhookApiVersion}/webhooks.json`,
      data,
    );
  }
  #verifyHMAC() {
    return async (ctx: Context, next: NextFunc) => {
      if (ctx.url.searchParams.get("hmac")) {
        return await this.#verifyAdminHMAC(ctx, next);
      }
      if (ctx.req.headers.get("X-Shopify-Hmac-Sha256")) {
        return await this.#verifyWebhookHMAC(ctx, next);
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
    const kvpairs: string[] = [];
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
