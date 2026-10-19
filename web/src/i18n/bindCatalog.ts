import sources from './sources.json';
export type Row = [en:string|null,zh:string|null,ja:string|null];
/** Ordered source catalog: null means an identifier or already-native source. */
export function bindCatalog(offset:number, rows:Row[]) {
  return Object.fromEntries(rows.map(([en,zh,ja],index)=>{
    const source=sources[offset+index];
    if(source===undefined)throw new Error('Translation source index out of range');
    return [source,{en:en??source,zh:zh??source,ja:ja??source}];
  }));
}
