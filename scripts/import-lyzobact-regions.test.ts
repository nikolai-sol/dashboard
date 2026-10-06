import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRegionalImportArgs} from './import-lyzobact-regions';
const args=['--register','register.json','--sources','sources.csv','--snapshot','audit-20261006','--label','Проверка источников 05–06.10.2026','--dashboard-id','1'];
test('manual import defaults to offline dry-run and requires explicit apply',()=>{assert.equal(parseRegionalImportArgs(args).apply,false);assert.equal(parseRegionalImportArgs([...args,'--apply']).apply,true);assert.throws(()=>parseRegionalImportArgs([...args,'--unexpected','1']));assert.throws(()=>parseRegionalImportArgs(args.slice(0,-2)));});
