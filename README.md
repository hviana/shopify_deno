Below is an enhanced version of your README with a cleaner structure, visual
enhancements, and icons. Feel free to tweak the icons or styling to suit your
branding!

---

# Shopify Deno 🚀

[![Deno](https://img.shields.io/badge/Deno-2.x-blue?logo=deno)](https://deno.land)
[![Shopify](https://img.shields.io/badge/Shopify-Integration-0B72B9?logo=shopify)](https://www.shopify.com)

> **Shopify Integration for Deno.**\
> _Note:_ `ShopifyAPI` works on any platform, but `ShopifyApp` is currently
> exclusive to Deno.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Application Setup](#application-setup)
  - [Creating Application Instances](#creating-application-instances)
  - [Routes Configuration](#routes-configuration)
- [API Usage](#api-usage)
- [Imports Overview](#imports-overview)
- [About](#about)

---

## Overview ⭐

This library provides a smooth integration between
[Shopify](https://www.shopify.com) and [Deno](https://deno.land).

- Use **ShopifyAPI** for platform-agnostic interactions.
- Leverage **ShopifyApp** for building Deno-specific applications.

---

## Getting Started 🔧

Install or import the library via your preferred Deno module management. For
more details, please refer to the [installation guide](#).

---

## Application Setup 🚀

### Creating Application Instances

This implementation lets you run multiple Shopify applications on the same
server effortlessly. Routes are automatically generated.

#### Example

```typescript
import { req, res, Server } from "jsr:@hviana/faster";
import { ShopifyAPI, ShopifyApp, WebHookCall } from "jsr:@hviana/shopify-deno";

const server = new Server();

// Define a custom home route for your app
server.get("/my_app_1_index", async (ctx: any, next: any) => {
  ctx.res.body = "My Shopify Deno";
  await next();
});

// Set up a Deno KV instance (configure your parameters as needed)
const kv = await Deno.openKv(); // Use your custom configuration here

// Instantiate your Shopify app with the necessary options
const shopifyApp1 = new ShopifyApp(
  {
    kv: kv,
    api_key: "79e4871756c98ccf48ac647c724022e1",
    api_secret: "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",
    scopes: "read_products,read_orders",
    host: "https://xxx.ngrok.io", // Do not end with a "/"
    namespace: "my_app_1_ns", // Use unique namespaces for multiple apps on the same server
    home_route: "/my_path1", // Simple path (query parameters are not allowed)
    // This path will receive the "shop" and "session" parameters (e.g., /my_path1?shop=example.myshopify.com&session=...)
    webhooks: [ // (Optional) Define your webhooks
      {
        topic: "orders/create", // Only one webhook per topic is allowed
        func: (hook: WebHookCall) => {
          // Avoid using await here to prevent Shopify webhook timeouts
          console.log(hook.data);
          console.log(hook.shop);
        },
      },
    ],
  },
  server,
);

// Start the server on port 80
await server.listen({ port: 80 });
```

> **Tip:** Check out the [`ShopifyAppOptions`](#) type for the full list of
> available options.

---

### Routes Configuration 🔄

Configure the auto-generated routes in your Shopify admin settings as follows:

1. **App URL:**
   ```
   "host"/"namespace"/install
   ```

2. **Allowed Redirection URLs:**
   ```
   "host"/"namespace"/auth
   "host"/"home_route"
   ```

3. **Privacy Policy:**
   ```
   "host"/"namespace"/privacy_policy
   ```

4. **Customer Data Request Endpoint:**
   ```
   "host"/"namespace"/webhooks/client_data
   ```

5. **Customer Data Erasure Endpoint:**
   ```
   "host"/"namespace"/webhooks/delete_client
   ```

6. **Shop Data Erasure Endpoint:**
   ```
   "host"/"namespace"/webhooks/delete_shop
   ```

Each webhook is automatically accessible at:

```
"host"/"namespace"/webhooks/"topic"
```

> **Note:** The library automatically registers these webhooks with the Shopify
> API.

---

## API Usage 📡

The library abstracts the communication with Shopify and manages API rate limits
seamlessly.

### GraphQL Example

```typescript
const access_token = await shopifyApp1.getAccessToken(shop);
const api = new ShopifyAPI(shop, access_token); // 'shop' is something like "myexampleshop.myshopify.com"

// Execute a GraphQL query to fetch product tags
const data1 = await api.graphQL(`
{
  products(first: 10, query:"tag:*(MY_TAG1)*") {
    edges {
      node {
        tags
      }
    }
  }
}
`);
```

### REST GET Request

```typescript
const data2 = await api.get(`/admin/api/2025-04/script_tags.json`);
```

### REST POST Request

```typescript
const data3 = await api.post(`/admin/api/2025-04/script_tags.json`, {
  "script_tag": {
    "event": "onload",
    "src": "https://xxx.ngrok.io/myscript.js",
    "cache": true,
  },
});
```

### StoreFront Call (GraphQL or REST)

Pass `true` as the second parameter to indicate a StoreFront call:

```typescript
await api.graphQL(
  `
  mutation {
    cartCreate(
      input: {
        lines: [{ quantity: 1, merchandiseId: "gid://shopify/ProductVariant/46983787708666" }]
        buyerIdentity: {
          email: "henrique@lafort.com.br"
          countryCode: BR
          deliveryAddressPreferences: [
            { deliveryAddress: { province: "Pinhais", country: "Brazil", zip: "83324500" } }
          ]
        }
      }
    ) {
      cart {
        checkoutUrl
        createdAt
        id
        ...DeliveryGroups @defer
      }
      userErrors {
        field
        message
      }
    }
  }
  fragment DeliveryGroups on Cart {
    deliveryGroups(first: 10, withCarrierRates: true) {
      edges {
        node {
          deliveryOptions {
            title
            handle
            deliveryMethodType
            estimatedCost {
              amount
            }
          }
          selectedDeliveryOption {
            title
            handle
            deliveryMethodType
            estimatedCost {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
  `,
  true,
);
```

---

## Imports Overview 📦

Include the necessary modules in your project:

```typescript
import {
  ShopifyAPI,
  ShopifyApp,
  ShopifyAppOptions,
  UserTokenFunc,
  WebHook,
  WebHookCall,
  WebHookFunc,
} from "jsr:@hviana/shopify-deno";
```

```typescript
import { req, res, Server } from "jsr:@hviana/faster";
```

> **Bonus:** The `ShopifyAPI` class includes additional abstracted methods
> (e.g., `includeScripts`, `searchTags`) that you might find useful.

---

## About 👤

**Author:** Henrique Emanoel Viana\
**Profession:** Computer Scientist & Web Technology Enthusiast\
**Contact:** +55 (41) 99999-4664\
**Website:** [henriqueviana](https://sites.google.com/view/henriqueviana)

Improvements and suggestions are always welcome!

---

_Happy Coding!_ 💻✨

---

This updated README should provide users with a clear, well-organized guide
along with visual cues to enhance readability and navigation. Enjoy!
