const RELATIONS = {
  dermavital_krem: {
    soap: 'dermavital_szappan',
    companion: 'dermavital_szappan',
    answers: {
      soap: 'A Dermavital krém mellé elsőként a Dermavital szappant javaslom. Kíméletesen tisztítja a száraz, érzékeny és ekcémára hajlamos bőrt, így jól kiegészíti a krém mindennapi használatát.',
      companion: 'A Dermavital krém mellé elsőként a Dermavital szappant javaslom. A szappan a kímélő tisztítást, a krém pedig a bőr mindennapi ápolását szolgálja.'
    }
  },
  dermavital_szappan: {
    cream: 'dermavital_krem',
    companion: 'dermavital_krem',
    answers: {
      cream: 'A Dermavital szappan mellé a Dermavital krémet javaslom. Tisztálkodás után kis mennyiségben vidd fel a száraz vagy irritált bőrfelületre.',
      companion: 'A Dermavital szappan mellé a Dermavital krémet javaslom. A két termék egymást kiegészítve használható.'
    }
  },
  dermavital_sampon: {
    soap: 'rozmaringos_samponszappan',
    companion: 'rozmaringos_samponszappan',
    answers: {
      soap: 'A Dermavital sampon mellé kiegészítőként a rozmaringos samponszappant javaslom, különösen viszkető vagy pikkelysömörre hajlamos fejbőrnél.',
      companion: 'A Dermavital sampon mellé kiegészítőként a rozmaringos samponszappan használható.'
    }
  },
  psorivital_csomag: {
    cream: 'holt_tengeri_so_balzsam',
    companion: 'holt_tengeri_so_balzsam',
    answers: {
      cream: 'A PsoriVital csomag mellé célzott ápolásra a Holt-tengeri só balzsamot javaslom.',
      companion: 'A PsoriVital csomag mellé kiegészítésként a Holt-tengeri só balzsamot javaslom.'
    }
  },
  aktiv_szenes_szappan: {
    companion: null,
    answers: {
      companion: 'Az Aktív szenes szappan mellé nem szükséges automatikusan másik terméket használni. Ha tisztálkodás után húzódik a bőr, ritkítsd a használatát, és válassz könnyű, nem zsíros hidratálást.'
    }
  },
  shea_vajas_szappan: {
    companion: null,
    answers: {
      companion: 'A Shea vajas szappan önmagában is jó választás kímélő tisztításhoz. Nagyon száraz bőrnél tisztálkodás után testápolóval vagy krémmel egészíthető ki.'
    }
  }
};

function requestedRelation(normalizedQuestion) {
  if (/szappan/.test(normalizedQuestion)) return 'soap';
  if (/krem|balzsam|testapolo/.test(normalizedQuestion)) return 'cream';
  if (/sampon/.test(normalizedQuestion)) return 'shampoo';
  return 'companion';
}

function isRelationQuestion(normalizedQuestion) {
  return /melle|egyutt|kiegeszit|mit hasznaljak|milyen szappant|melyik szappant|milyen kremet|melyik kremet/.test(normalizedQuestion);
}

function resolveRelation(productId, normalizedQuestion) {
  const relation = RELATIONS[productId];
  if (!relation) return null;
  const type = requestedRelation(normalizedQuestion);
  const relatedProduct = relation[type] !== undefined ? relation[type] : relation.companion;
  const answer = relation.answers?.[type] || relation.answers?.companion;
  if (!answer) return null;
  return { type, relatedProduct, answer };
}

module.exports = { RELATIONS, isRelationQuestion, resolveRelation };
