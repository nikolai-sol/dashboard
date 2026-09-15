// Closed vocabularies only. Error properties, stacks and causes are never read.
export const DIAGNOSTIC_STAGES=Object.freeze(['unknown','setup','forward','consumer_load','issuer','credential_frame','report','cleanup','alias_manager_json','alias_embed_json','admin_manager','admin_embed_denial','privacy_shape','pdf_fetch','pdf_parse','pdf_compare','excel_fetch','excel_parse','excel_compare','json_compare','asset_html','asset_fetch','asset_attestation','asset_compare','capture_launch','capture_navigation','capture_render','capture_screenshot','capture_dimensions','capture_compare','capture_console','capture_output']);
export const DIAGNOSTIC_REASONS=Object.freeze(['unknown','failed','status','content_type','cache_policy','shape','mismatch','boundary','limit','cancelled','deadline','child_protocol','http_status','body_limit','malformed_html','no_assets','unexpected_asset_origin','unexpected_asset_path','inventory_limit','alias_mismatch','control_4xx','control_5xx','candidate_4xx','candidate_5xx','control_other_status','candidate_other_status','record_schema','pin_mismatch','tree_hash','asset_prefix','predecessor','transport','source_proof','metadata']);
const records=new WeakMap();
export function markDiagnostic(error,stage,reason='failed') {
  records.set(error,Object.freeze({stage:DIAGNOSTIC_STAGES.includes(stage)?stage:'unknown',reason:DIAGNOSTIC_REASONS.includes(reason)?reason:'unknown'}));return error;
}
export function carryDiagnostic(target,source,stage='unknown',reason='unknown') {
  const known=records.get(source);return markDiagnostic(target,known?.stage??stage,known?.reason??reason);
}
export function formatVerificationFailure(error) {
  const known=records.get(error);
  return `ABBOTT_VERIFICATION_REFUSED stage=${known?.stage??'unknown'} reason=${known?.reason??'unknown'}\n`;
}
export function diagnosticFromChild(result) {
  const error=new Error('ABBOTT_VERIFICATION_REFUSED');
  if(result?.status!==1||result.signal||!Buffer.isBuffer(result.stdout)||result.stdout.length||!Buffer.isBuffer(result.stderr)||result.stderr.length>160)return error;
  const match=/^ABBOTT_VERIFICATION_REFUSED stage=([a-z_]+) reason=([a-z0-9_]+)\n$/.exec(result.stderr.toString('utf8'));
  if(!match||!DIAGNOSTIC_STAGES.includes(match[1])||!DIAGNOSTIC_REASONS.includes(match[2]))return error;
  return markDiagnostic(error,match[1],match[2]);
}
