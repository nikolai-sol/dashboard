// Closed vocabularies only. Error properties, stacks and causes are never read.
export const DIAGNOSTIC_STAGES=Object.freeze(['unknown','setup','forward','consumer_load','issuer','credential_frame','report','cleanup','alias_manager_json','alias_embed_json','admin_manager','admin_embed_denial','privacy_shape','pdf_fetch','pdf_parse','pdf_compare','excel_fetch','excel_parse','excel_compare','json_compare','asset_html','asset_fetch','asset_attestation','asset_compare','capture_launch','capture_navigation','capture_render','capture_screenshot','capture_dimensions','capture_compare','capture_console','capture_output']);
export const DIAGNOSTIC_REASONS=Object.freeze(['unknown','failed','status','content_type','cache_policy','shape','mismatch','boundary','limit','cancelled','deadline','child_protocol','http_status','body_limit','malformed_html','no_assets','unexpected_asset_origin','unexpected_asset_path','inventory_limit','alias_mismatch','control_4xx','control_5xx','candidate_4xx','candidate_5xx','candidate_pdf_authorize','candidate_pdf_launch','candidate_pdf_prepare','candidate_pdf_navigate','candidate_pdf_ready','candidate_pdf_render','control_other_status','candidate_other_status','record_schema','pin_mismatch','tree_hash','asset_prefix','predecessor','transport','source_proof','metadata','local_capsule','ssh_spawn','ssh_stdin','ssh_timeout','ssh_exit','ssh_stderr_frame','remote_import','remote_source_proof','remote_attestation','asset_read','result_contract','guarded_cleanup','off_origin_image','off_origin_other','redirect','url_credentials','malformed_url','page_count','page_dimensions','text_digest','pdf_shape','console_resource','console_runtime','console_other','resource_favicon_4xx','resource_image_4xx','resource_image_5xx','resource_style_4xx','resource_style_5xx','resource_script_4xx','resource_script_5xx','resource_data_4xx','resource_data_5xx','resource_other_4xx','resource_other_5xx','resource_request_failed']);
// Orchestrator-only boundaries supplement the remote/SSH vocabulary.
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
