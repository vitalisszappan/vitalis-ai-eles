const PRODUCTS = {
  dermavital_sampon: {
    id: 'dermavital_sampon',
    name: 'Dermavital sampon',
    description: 'Problémás, korpás, viszkető vagy hámló fejbőr kímélő tisztítására.',
    url: null,
    image: null
  },
  rozmaringos_samponszappan: {
    id: 'rozmaringos_samponszappan',
    name: 'Rozmaringos samponszappan',
    description: 'Kiegészítő haj- és fejbőrápolásra, különösen viszkető vagy pikkelysömörre hajlamos fejbőrnél.',
    url: null,
    image: null
  },
  dermavital_krem: {
    id: 'dermavital_krem',
    name: 'Dermavital krém',
    description: 'Száraz, érzékeny, irritált és ekcémára hajlamos bőr ápolására.',
    url: 'https://www.vitalis-szappan.hu/dermavital-balzsam-100-ml',
    image: null
  },
  dermavital_szappan: {
    id: 'dermavital_szappan',
    name: 'Dermavital szappan',
    description: 'Kímélő tisztálkodás száraz, érzékeny és ekcémára hajlamos bőrre.',
    url: 'https://www.vitalis-szappan.hu/vitalis-dermavital-szappan',
    image: null
  },
  psorivital_csomag: {
    id: 'psorivital_csomag',
    name: 'PsoriVital csomag',
    description: 'Száraz, hámló és pikkelysömörre hajlamos bőr kozmetikai ápolására.',
    url: null,
    image: null
  },
  holt_tengeri_so_balzsam: {
    id: 'holt_tengeri_so_balzsam',
    name: 'Holt-tengeri só balzsam',
    description: 'Száraz, hámló és problémás bőr célzott kozmetikai ápolására.',
    url: 'https://www.vitalis-szappan.hu/termek/holt-tengeri-so-balzsam',
    image: null
  },
  holt_tengeri_iszapos_szappan: {
    id: 'holt_tengeri_iszapos_szappan',
    name: 'Holt-tengeri iszapos szappan',
    description: 'Problémás, száraz és hámló bőr kíméletes tisztítására.',
    url: null,
    image: null
  },
  aktiv_szenes_szappan: {
    id: 'aktiv_szenes_szappan',
    name: 'Aktív szenes szappan',
    description: 'Zsíros, pattanásos bőr mindennapi tisztítására.',
    url: null,
    image: null
  },
  katrany_szappan: {
    id: 'katrany_szappan',
    name: 'Gyógyászati kátrány szappan',
    description: 'Makacsabb, problémás és pattanásos bőr tisztítására.',
    url: null,
    image: null
  },
  shea_vajas_szappan: {
    id: 'shea_vajas_szappan',
    name: 'Shea vajas szappan',
    description: 'Száraz, húzódó bőr kímélő mindennapi tisztítására.',
    url: null,
    image: null
  }
};

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') return fallback;
  return text;
}

function productCards(ids = []) {
  return ids
    .map((id, index) => {
      const product = PRODUCTS[id];
      if (!product) return null;
      const name = cleanText(product.name, 'Vitalis termék');
      return {
        id: cleanText(product.id, String(id || `product_${index + 1}`)),
        name,
        title: name,
        label: name,
        description: cleanText(product.description),
        url: cleanText(product.url),
        image: cleanText(product.image),
        rank: index + 1,
        recommendationType: index === 0 ? 'primary' : 'secondary'
      };
    })
    .filter(Boolean);
}

module.exports = { PRODUCTS, productCards };
