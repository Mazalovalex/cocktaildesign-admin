# Основные принципы

MoySklad управляет:
-   товарами
-   ценами
-   категориями

Strapi:
-   хранит копию данных
-   принимает webhook
-   отдаёт API frontend

Strapi НЕ управляет товарами вручную.

------------------------------------------------------------------------

# Основные endpoints

Sync products:

POST

    /api/moysklad/sync/products

Header:

    x-webhook-secret: super-secret-string

------------------------------------------------------------------------

Webhook endpoint:

POST

    /api/moysklad/webhook?secret=super-secret-string

------------------------------------------------------------------------

Products API:

GET

    /api/moysklad-products

------------------------------------------------------------------------

Products with category:

    /api/moysklad-products?populate=category

------------------------------------------------------------------------

Product by moyskladId:

    /api/moysklad-products?filters[moyskladId][$eq]=ID

------------------------------------------------------------------------

Sync status:

    /api/moysklad/sync/status

------------------------------------------------------------------------

# Проверка всей системы одной командой

    BASE="http://localhost:1337"; SECRET="super-secret-string"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "STRAPI HEALTH"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    curl -sS -o /dev/null -w "HTTP %{http_code}\n" "$BASE/admin"; \
    echo; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "SYNC STATUS"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    curl -sS "$BASE/api/moysklad/sync/status" | jq '.ok, .state.status, .state.lastRunKind, .state.lastTotals'; \
    echo; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "SYNC PRODUCTS"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    curl -sS -X POST "$BASE/api/moysklad/sync/products" \
      -H "x-webhook-secret: $SECRET" | jq; \
    echo; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "WEBHOOK TEST"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
      -X POST "$BASE/api/moysklad/webhook?secret=$SECRET" \
      -H "Content-Type: application/json" \
      -d '{"events":[{"action":"UPDATE","meta":{"href":"https://api.moysklad.ru/api/remap/1.2/entity/product/test","type":"product"}}]}'; \
    echo; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "PRODUCT SAMPLE"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    curl -sS --globoff "$BASE/api/moysklad-products?pagination[pageSize]=1&populate=category" \
     | jq '.data[0] | { id, name, price, priceOld, category: (.category | { id, name, moyskladId }) }'; \
    echo; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
    echo "DONE"; \
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"


# Что синхронизируется

Категории\
Товары\
Webhook события


Товары (публичное чтение)
GET /api/moysklad-products
GET /api/moysklad-products?populate=category
GET /api/moysklad-products?filters[moyskladId][$eq]=<ID>&populate=category
GET /api/moysklad/sync/status (диагностика/виджет статуса)

