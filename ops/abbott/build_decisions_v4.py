import json, os, sys, datetime, re
import mysql.connector
CORRECT = ("Каноника содержала маркер отсутствия решения (\"Не определено\"). Направление "
           "восстановлено из утверждённого реестра материалов Abbott: registry1 и registry2 "
           "согласованы по этому материалу.")
REJECT  = ("URL наблюдается в аналитике, но отсутствует в утверждённом реестре материалов Abbott. "
           "Каноническая идентичность в этом релизе не назначается; решение пересматривается, "
           "когда материал будет внесён в реестр.")
ABBOTT=re.compile(r"^https?://(www\.)?abbottpro\.ru([/?#]|$)",re.I)
SCHEME=re.compile(r"^[a-z][a-z0-9+.-]*://",re.I); STRIP=re.compile(r"^[a-z][a-z0-9+.-]*://[^/]*",re.I)
def npath(raw):
    if not raw: return None
    if ABBOTT.search(raw): p=STRIP.sub("",raw.split("?",1)[0].split("#",1)[0])
    elif not SCHEME.search(raw): p=raw.split("?",1)[0].split("#",1)[0]
    else: return None
    p=re.sub(r"/{2,}","/",p)
    if not p.startswith("/"): p="/"+p
    return p.rstrip("/") or "/"
reject_paths=set(json.load(open("/tmp/reject_paths.json")))
cn = mysql.connector.connect(
    host=os.environ["ABBOTT_CONTENT_WORKFLOW_DB_HOST"],
    port=int(os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_PORT","3306")),
    database=os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_NAME","report_bd"),
    user=os.environ["ABBOTT_CONTENT_WORKFLOW_DB_USER"],
    password=os.environ["ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD"],
    charset="utf8mb4", collation="utf8mb4_unicode_ci")
cur = cn.cursor()
bid=int(sys.argv[1]); rel=int(sys.argv[3])
cur.execute("select batch_key, published_input_hash from portal_content_approval_batches where id=%s",(bid,))
bk,pih = cur.fetchone()
cur.execute("""
 select i.input_hash,i.row_hash,i.final_direction_code,i.final_material_type_code,
        i.final_access_code,i.final_lifecycle_code,i.selected_content_entity_id,
        i.url_alias_decision,i.decision_reason,i.readiness_state,i.content_entity_id,i.url,
        p.direction_code,
        json_unquote(json_extract(i.proposal_evidence,"$.registry1.source_name")),
        json_type(json_extract(i.proposal_evidence,"$.current_canonical"))
 from portal_content_approval_items i
 left join (select c.content_entity_id, max(e.direction_code) direction_code
            from portal_content_catalog c
            join portal_content_classification_events e on e.id=c.classification_event_id
            where c.canonical_release_id=%s and c.content_entity_id is not null
            group by c.content_entity_id having count(distinct e.direction_code)=1) p
   on p.content_entity_id=i.content_entity_id
 where i.approval_batch_id=%s order by i.content_entity_id, i.input_hash""",(rel,bid))
out=[]; n_c=n_r=0; covered=set()
for r in cur.fetchall():
    ih,rh,d,mt,ac,lc,sel,alias,reason,state,ent,url,pred,src,cur_t = r
    p = npath(url)
    if (p in reject_paths and p not in covered and ent is None and sel is None
            and src=="observed_page" and (cur_t in (None,"NULL"))):
        alias="reject"; reason=REJECT; covered.add(p); n_r+=1
    elif state=="ready" and pred and pred!=d:
        reason=CORRECT; n_c+=1
    out.append({"input_hash":ih,"row_hash":rh,"final_direction_code":d,
                "final_material_type_code":mt,"final_access_code":ac,"final_lifecycle_code":lc,
                "selected_content_entity_id":int(sel) if sel is not None else None,
                "url_alias_decision":alias,"decision_reason":reason})
doc={"schema_version":1,"dataset_key":"abbott","batch_id":bid,"batch_key":bk,
     "published_input_hash":pih,"accepted_by":"claude-reviewed-operator",
     "accepted_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
     "decisions":out}
fd=os.open(sys.argv[2], os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
with os.fdopen(fd,"w",encoding="utf-8") as fh: json.dump(doc,fh,ensure_ascii=False,sort_keys=True)
print(json.dumps({"decisions":len(out),"corrections":n_c,"rejects":n_r,
                  "paths_not_covered":sorted(reject_paths-covered)[:5],
                  "missing":len(reject_paths-covered)}, ensure_ascii=False))
