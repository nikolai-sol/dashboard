import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planAbbottNginxPortSwitch} from './abbott-runtime-release-remote.mjs';
// Keep the existing lexical/differential accepted and refused fixtures in this gate.
import './abbott-nginx-readonly.test.mjs';

const EXACT = ['/dashboard/18','/dashboard/18/','/dashboard/abbott','/dashboard/abbott/',
  '/api/dashboard/18','/api/dashboard/18/pdf','/api/dashboard/18/excel',
  '/api/dashboard/18/abbott-admin-users','/api/dashboard/abbott','/api/dashboard/abbott/pdf',
  '/api/dashboard/abbott/excel','/api/dashboard/abbott/abbott-admin-users'];
const identities = [...EXACT.map(route => '= '+route),'^~ /_next-abbott/'];
const body = (identity, port=3001) => `location ${identity} {
  proxy_pass http://127.0.0.1:${port};
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}`;
const fixture = (position=1,port=3001) => {
  const names=['first.example','last.example'];names.splice(position,0,'dashboards.adreports.ru');
  return '# UTF-8: Grüße 日本語 😀; foreign 3004 comment\n'+
    'server { listen 80; server_name dashboards.adreports.ru; return 301 https://$host$request_uri; }\n'+
    `server { listen 443 ssl; server_name ${names.join(' ')};\n`+
    identities.slice().reverse().map(id=>body(id,port)).join('\n')+
    '\nlocation /foreign { proxy_pass http://127.0.0.1:3003; }\n}\n';
};
const sha = value => createHash('sha256').update(value).digest('hex');
const byteDiffs = (a,b) => [...Buffer.from(a)].flatMap((v,i)=>v===Buffer.from(b)[i]?[]:[i]);
const masked = (text,replacements) => {const bytes=Buffer.from(text);for(const r of replacements)bytes.fill(0,r.byteStart,r.byteEnd);return sha(bytes);};

for(const position of [0,1,2])test('exact reversible 13-token plan with composite host position '+position,()=>{
  const source=fixture(position),plan=planAbbottNginxPortSwitch(source,3001,3004);
  assert.equal(plan.replacements.length,13);
  assert.deepEqual(plan.routeIdentities,[...identities].sort());
  assert.equal(Buffer.byteLength(plan.candidate),Buffer.byteLength(source));
  assert.equal(byteDiffs(source,plan.candidate).length,13);
  assert.equal(plan.replacements.reduce((n,r)=>n+r.byteEnd-r.byteStart,0),52);
  assert.ok(byteDiffs(source,plan.candidate).every(i=>plan.replacements.some(r=>i>=r.byteStart&&i<r.byteEnd)));
  for(const [i,r]of plan.replacements.entries()){
    assert.equal(Buffer.from(source).subarray(r.byteStart,r.byteEnd).toString(),'3001');
    assert.equal(Buffer.from(plan.candidate).subarray(r.byteStart,r.byteEnd).toString(),'3004');
    assert.equal(r.from,'3001');assert.equal(r.to,'3004');assert.ok(identities.includes(r.route));
    if(i)assert.ok(plan.replacements[i-1].byteEnd<=r.byteStart);
    assert.ok(Object.isFrozen(r));
  }
  assert.equal(plan.predecessorSha256,sha(source));assert.equal(plan.candidateSha256,sha(plan.candidate));
  assert.equal(plan.nonOwnedSha256,masked(source,plan.replacements));
  assert.equal(plan.nonOwnedSha256,masked(plan.candidate,plan.replacements));
  for(const value of [plan,plan.routeIdentities,plan.replacements])assert.ok(Object.isFrozen(value));
  const inverse=planAbbottNginxPortSwitch(plan.candidate,3004,3001);
  assert.equal(inverse.candidate,source);assert.equal(inverse.nonOwnedSha256,plan.nonOwnedSha256);
  assert.equal(inverse.predecessorSha256,plan.candidateSha256);assert.equal(inverse.candidateSha256,plan.predecessorSha256);
});

test('rollback preserves foreign bytes added to the latest input',()=>{
  const source=fixture(),foreign='\n# later foreign change ✓\nserver { listen 8080; server_name other.example; location /later { return 204; } }\n';
  const switched=planAbbottNginxPortSwitch(source,3001,3004).candidate;
  assert.equal(planAbbottNginxPortSwitch(switched+foreign,3004,3001).candidate,source+foreign);
});

test('planner refuses malformed or ambiguous input with only the fixed error',async t=>{
  const source=fixture(),first=body('^~ /_next-abbott/'),proxy='proxy_pass http://127.0.0.1:3001;';
  const cases=[
    ['wrong destination',source,3001,3002],['same port',source,3001,3001],
    ['string source',source,'3001',3004],['float source',source,3001.5,3004],
    ['string destination',source,3001,'3004'],['float destination',source,3001,3004.5],
    ['absent host',source.replaceAll('dashboards.adreports.ru','other.example')],
    ['duplicate TLS',source+'server { listen 443 ssl; server_name dashboards.adreports.ru; }'],
    ['unsafe sibling',source.replace('listen 80;','listen 81;')],
    ['escaped host',source.replaceAll('dashboards.adreports.ru','dashboards.adreports\\.ru')],
    ['missing',source.replace(first,'')],['duplicate',source.replace(first,first+'\n'+first)],
    ['14th identity',source.replace(first,first+'\n'+body('= /dashboard/18/extra'))],
    ['broad owned',source.replace('location = /dashboard/18 {','location /dashboard/18 {')],
    ['regex owned',source.replace('location = /dashboard/18 {','location ~ ^/dashboard/18 {')],
    ['nested owned',source.replace(first,'location /foreign-nest { '+first+' }')],
    ['include owned',source.replace(first,'include /etc/nginx/abbott-routes.conf;')],
    ['opaque missing owned',source.replace(first,'include /etc/nginx/foreign.conf;')],
    ['owned nested in arbitrary block',source.replace(first,'if ($host) { '+first+' }')],
    ['mixed source ports',source.replace(proxy,proxy.replace('3001','3004'))],
    ['quoted target',source.replace(proxy,'proxy_pass "http://127.0.0.1:3001";')],
    ['escaped target',source.replace(proxy,'proxy_pass http://127.0.0.1:300\\1;')],
    ['computed target',source.replace(proxy,'proxy_pass http://127.0.0.1:$port;')],
    ['braced variable',source.replace(proxy,'proxy_pass http://127.0.0.1:${port};')],
    ['rewrite',source.replace(proxy,proxy+' rewrite ^ /foreign;')],
    ['extra directive',source.replace(proxy,proxy+' proxy_redirect off;')],
    ['wrong header name',source.replace('proxy_set_header Host $host;','proxy_set_header Other $host;')],
    ['wrong header value',source.replace('proxy_set_header Host $host;','proxy_set_header Host $server_name;')],
    ['wrong header order',source.replace('proxy_set_header Host $host;\n  proxy_set_header X-Real-IP $remote_addr;','proxy_set_header X-Real-IP $remote_addr;\n  proxy_set_header Host $host;')],
    ['missing header',source.replace('proxy_set_header Host $host;','')],
    ['second proxy',source.replace(proxy,proxy+' '+proxy)],
    ['outside Abbott route',source+'server { listen 81; location /dashboard/18 { return 404; } }'],
    ['outside Abbott numeric alias',source+'server { listen 81; location /dashboard/018 { return 404; } }'],
    ['outside 3004',source+'server { listen 81; location /other { proxy_pass http://127.0.0.1:3004; } }'],
    ['outside string path',source+'set $private /api/dashboard/abbott;'],
    ['outside Abbott include',source.replace('location /foreign {','include /etc/nginx/abbott-routes.conf; location /foreign {')],
    ['outside queried route',source+'server { listen 81; return 301 /dashboard/18?private=1; }'],
    ['outside regex alternative',source+'server { listen 81; location ~ ^/dashboard/(18|19) { return 404; } }'],
    ['unbalanced brace',source+'}'],['unclosed quote',source+'set value "private;'],
    ['NUL',source+'\0'],['control',source+'\x01'],['DEL',source+'\x7f'],
    ['non-string',{}],['null',null],['oversize',source+'#'+'x'.repeat(1048576)],
  ];
  for(const [name,text,from=3001,to=3004]of cases)await t.test(name,()=>{
    assert.throws(()=>planAbbottNginxPortSwitch(text,from,to),error=>error?.constructor===Error&&error.message==='ABBOTT_NGINX_ROUTE_PLAN_REFUSED'&&error.cause===undefined);
  });
});
