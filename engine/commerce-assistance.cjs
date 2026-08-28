'use strict';

const { productCards } = require('./product-catalog.cjs');
const { createCatalogSearch, validUrl } = require('./catalog-search.cjs');

const CHECKOUT_HELP = 'Sajnálom, hogy elakadtál; írd meg, hogy a kosárnál, az adatok megadásánál vagy a fizetésnél nem enged tovább, és látsz-e konkrét hibaüzenetet. Kérlek, bankkártyaadatot, jelszót vagy más érzékeny fizetési adatot ne küldj.';
const ORDERING_HELP = 'Válaszd ki a terméket, nyisd meg a termékkártyán a webshopos termékoldalt, majd a webshopban tedd kosárba, és kövesd a pénztár lépéseit.';
const CONFIRMATION_HELP = 'A rendelés meglétét vagy állapotát ebből a beszélgetésből nem tudom ellenőrizni. Rendelésspecifikus ellenőrzéshez írj az ugyfelszolgalat@vitalis-szappan.hu címre. Bankkártyaadatot, jelszót vagy más érzékeny fizetési adatot ne küldj.';

function safeCatalogCard(target, catalog) {
  const canonical = productCards([target])[0];
  if (canonical?.url && canonical.availability?.public !== false && canonical.availability?.active !== false && canonical.availability?.orderable !== false) return canonical;
  const product = catalog.all().find((item) => item.id === target || item.unasId === target);
  const url = validUrl(product?.url);
  if (!product || !url || !product.public || !product.active || !product.orderable) return null;
  return {
    id: product.id, name: product.name, title: product.name, label: product.name,
    description: '', url, image: product.image || '', rank: 1,
    recommendationType: 'primary', price: product.price, currency: product.currency,
    availability: { public: product.public, active: product.active, orderable: product.orderable },
    commerce: { source: 'unas', unasId: product.unasId, sku: product.sku }
  };
}

function createCommerceAssistance({ catalog = createCatalogSearch() } = {}) {
  function resolve({ routing }) {
    if (routing?.route !== 'commerce') return null;
    const target = routing.contextTarget && routing.contextTarget !== 'product' ? routing.contextTarget : null;
    if (routing.intent === 'order_start') {
      if (!target) return null;
      const card = safeCatalogCard(target, catalog);
      if (!card) return {
        source: 'commerce-assistance', answer: 'A kiválasztott termékhez most nincs ellenőrzött, rendelhető webshoplinkünk.',
        links: [], suggestions: [], confidence: 100, intent: routing.intent
      };
      return {
        source: 'commerce-assistance',
        answer: `Ezt választottad: ${card.name}. A termékkártyán megnyithatod a webshopos termékoldalt, ahol kosárba teheted.`,
        links: [card], suggestions: [], confidence: 100, intent: routing.intent
      };
    }
    if (routing.intent === 'ordering_help') {
      const card = target ? safeCatalogCard(target, catalog) : null;
      return { source: 'commerce-assistance', answer: ORDERING_HELP, links: card ? [card] : [], suggestions: [], confidence: 100, intent: routing.intent, targetProductId: card ? target : null };
    }
    if (routing.intent === 'checkout_problem') {
      const card = target ? safeCatalogCard(target, catalog) : null;
      return { source: 'commerce-assistance', answer: CHECKOUT_HELP, links: card ? [card] : [], suggestions: [], confidence: 100, intent: routing.intent, targetProductId: card ? target : null };
    }
    if (routing.intent === 'order_confirmation_problem') return { source: 'commerce-assistance', answer: CONFIRMATION_HELP, links: [], suggestions: [], confidence: 100, intent: routing.intent };
    return null;
  }
  return { resolve };
}

module.exports = { createCommerceAssistance, safeCatalogCard, CHECKOUT_HELP, ORDERING_HELP, CONFIRMATION_HELP };
