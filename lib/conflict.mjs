// Dropbox appends the conflict marker before the Excel extension.
const suffix = /\s*\((?:copia en conflicto(?: de [^()]*)?|[^()]*conflicted copy[^()]*)\)(?=\.xls[xm]?$)/i;
export const isConflict = name => suffix.test(name);
export const family = name => name.replace(suffix,'').normalize('NFC').toLowerCase();

export function snapshot(sheets) {
  const cells = new Map();
  for (const sheet of sheets) {
    cells.set(JSON.stringify([sheet.name]),'sheet');
    for (const c of sheet.cells) {
      if (c.value == null && !c.formula) continue;
      cells.set(JSON.stringify([sheet.name,c.ref]),JSON.stringify([c.type,c.value,c.formula]));
    }
  }
  return cells;
}
function differences(base, candidate) {
  for (const [key,value] of base.cells) {
    if (candidate.cells.get(key)!==value) return JSON.parse(key).join('!');
  }
  return '';
}
export function resolveFamily(files) {
  const failed=files.find(f=>f.error);
  if (failed) return {reason:failed.name+' · '+failed.error};
  if (!files.length) return {reason:'Sin fichas disponibles.'};
  if (files.length===1) return {winner:files[0]};
  const candidates=files.filter(f=>files.every(other=>!differences(other,f)));
  if (!candidates.length) {
    const changes=files.map(f=>{
      const changed=files.map(other=>differences(f,other)).find(Boolean);
      return f.name+' · '+(changed || 'sin celdas exclusivas');
    });
    return {reason:'Versiones divergentes. Comprobar '+changes.join(' / ')};
  }
  if (candidates.length<files.length && files.every(f=>f.modified instanceof Date)) {
    const newestComplete=Math.max(...candidates.map(f=>f.modified.getTime()));
    if(files.some(f=>!candidates.includes(f) && f.modified.getTime()>=newestComplete))
      return {reason:'El contenido más completo no tiene una fecha posterior. Verificar si hubo una corrección o eliminación intencional.'};
  }
  const winner=candidates.find(f=>!isConflict(f.name)) ?? candidates[0];
  return {winner,reason:candidates.length===files.length?'Contenido de celdas equivalente.':'Conserva las celdas de todas las versiones y agrega información.'};
}
