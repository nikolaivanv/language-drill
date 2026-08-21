import { ALL_CURRICULA, enumerateCurriculumCells } from '@language-drill/db';
const cells = enumerateCurriculumCells(ALL_CURRICULA);
const byLang = {}, byType = {}, byLangLevel = {};
for (const c of cells) {
  byLang[c.language] = (byLang[c.language]||0)+1;
  byType[c.exerciseType] = (byType[c.exerciseType]||0)+1;
  const k = c.language+':'+c.cefrLevel; byLangLevel[k]=(byLangLevel[k]||0)+1;
}
console.log('TOTAL schedulable cells:', cells.length);
console.log('by language:', JSON.stringify(byLang));
console.log('by type:', JSON.stringify(byType));
const s={}; for (const k of Object.keys(byLangLevel).sort()) s[k]=byLangLevel[k];
console.log('by lang:level:', JSON.stringify(s));
