# shopify_deno

Shopify Integration for Deno.

## How to use

This library has an abstraction of the application and the use of the API.

### Creating the application instances

This implementation allows several applications in the same server instance in a
simple way. Routes are automatically generated.

#### Example:

```typescript
import { req, res, Server } from "https://deno.land/x/faster/mod.ts";
import {
  ShopifyAPI,
  ShopifyApp,
  WebHookCall,
} from "https://deno.land/x/shopify_deno/mod.ts";
const server = new Server();
server.get(
  "/my_app_1_index", //shopifyApp1 home route
  async (ctx: any, next: any) => {
    ctx.res.body = "My Shopify Deno";
    await next();
  },
);

const shopifyApp1 = new ShopifyApp(
  {
    api_key: "79e4871756c98ccf48ac647c724022e1",
    api_secret: "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",
    scopes: "read_products,read_orders",
    host: "https://xxx.ngrok.io",
    namespace: "my_app_1_ns", //you can instantiate different apps on the same server with different namespaces
    home_route: "/my_app_1_index",
    userTokenFunc: async (shop: string, access_token: string) => { //OPTIONAL
      //SAVE shop access_token HERE, for later use.
      //need to return url parameters, default is (if userTokenFunc not defined):
      return `${access_token}&shop=${shop}`;
    },
    clientDataFunc: async (ctx: Context, data: WebHookCall) => {
      // process client data
    },
    webhooks: [ //OPTIONAL
      {
        topic: "orders/create",
        func: (ctx:Context,data: WebHookCall) => {
          //avoid using await here, prevent shopify webhook timeout is important
          console.log(data.data);
          console.log(data.shop);
        },
      },
    ],
  },
  server,
);
await server.listen({ port: 80 });
```

See type "ShopifyAppOptions" for full options.

#### Configure auto renerated routes

In Shopify Configs, configure:

1. App URL:

```
"host"/"namespace"/install
```

2. Allowed redirection URL(s):

```
"host"/"namespace"/auth
"host"/"home_route"
```

3. Privacy policy:

```
"privacy_route"
```

4. Customer data request endpoint:

```
"host"/"namespace"/webhooks/client_data
```

5. Customer data erasure endpoint:

```
"host"/"namespace"/webhooks/delete_client
```

6. Shop data erasure endpoint:

```
"host"/"namespace"/webhooks/delete_shop
```

Each webhook is automatically placed in (for information only, the library
registers automatically with the api):

```
"host"/"namespace"/webhooks/"topic"
```

### Using the API

This library abstracts the communication and handles the "API rate limit".

Examples:

```typescript
const api = new ShopifyAPI(shop, access_token); // 'shop' it's something like myexampleshop.myshopify.com, 'shop' and 'access_token' comes from 'userTokenFunc'
const data1 = await api.graphQL(`
{
    products(first: 10, query:"tag:*(MY_TAG1)*"){
      edges{
        node {
          tags
        }
      }
    }
}
`);
const data2 = await api.get(
  `/admin/api/2021-01/script_tags.json`,
);
const data3 = await this.post(`/admin/api/2021-01/script_tags.json`, {
  "script_tag": {
    "event": "onload",
    "src": "https://xxx.ngrok.io/myscript.js",
    "cache": true,
  },
});
```

## All imports

```typescript
import {
  ShopifyAPI,
  ShopifyApp,
  ShopifyAppOptions,
  UserTokenFunc,
  WebHook,
  WebHookCall,
  WebHookFunc,
} from "https://deno.land/x/shopify_deno/mod.ts";
```

```typescript
import { req, res, Server } from "https://deno.land/x/faster/mod.ts";
```

This library has some more abstracted methods for some applications I created,
explore the ShopifyAPI class (may be useful for you). Some examples are:
"includeScripts" and "searchTags".

## About

Author: Henrique Emanoel Viana, a Brazilian computer scientist, enthusiast of
web technologies, cel: +55 (41) 99999-4664. URL:
https://sites.google.com/view/henriqueviana

Improvements and suggestions are welcome!
