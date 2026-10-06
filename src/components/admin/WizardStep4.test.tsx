import test from 'node:test';
import assert from 'node:assert/strict';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Step from './WizardStep4';
import type { DashboardFormData } from '../../lib/admin-ui-types';
import { normalizeDashboardPayload } from '../../lib/admin-dashboards';

type Props = {children?:ReactNode; type?:string; checked?:boolean; onChange?:(event:{target:{checked:boolean}})=>void; onClick?:()=>void;};
function elements(node:ReactNode):ReactElement<Props>[] {
 return Children.toArray(node).flatMap(child=>isValidElement<Props>(child)?[child,...elements(child.props.children)]:[]);
}
function creativeControl(tree:ReactNode) {
 const label=elements(tree).find(e=>e.type==='label' && Children.toArray(e.props.children).includes('Creative performance / Креативы'));
 assert.ok(label); const input=elements(label.props.children).find(e=>e.type==='input');assert.ok(input);return input;
}
function fixture():DashboardFormData {return {client_id:'1',client_name:'Client',dashboard_name:'Media',dashboard_type:'awareness',sources:[],media_plan_bindings:[],config:{currency:'EUR',language:'en',period_from:'2026-09-01',period_to:'2026-09-30',logo_url:'',spend_source:'platform_actual',filter_scope:'both',visible_metrics:['impressions','clicks'],section_order:['kpi_grid'],show_spend:false,show_ai_summary:false,kpi_cards:['impressions','clicks','ctr','views','reach']}};}

test('existing Metrics controls toggle, save/reload and reorder platform creative section',()=>{
 let data=fixture(); const render=()=>Step({data,onChange:next=>{data=next;}});
 assert.equal(creativeControl(render()).props.checked,true);
 creativeControl(render()).props.onChange!({target:{checked:false}});
 assert.equal(data.config.show_creative_performance,false);
 // The existing API normalizer preserves the setting and order in config JSON.
 const stored=normalizeDashboardPayload(data);
 data={...data,config:JSON.parse(JSON.stringify(stored.config))};
 assert.equal(creativeControl(render()).props.checked,false);
 assert.deepEqual(data.config.section_order,['kpi_grid']);
 creativeControl(render()).props.onChange!({target:{checked:true}});
 assert.equal(data.config.show_creative_performance,true);
 const row=elements(render()).find(e=>e.type==='div' && Children.toArray(e.props.children).some(c=>isValidElement<Props>(c)&&c.type==='label'&&Children.toArray(c.props.children).includes('Creative performance / Креативы')));
 assert.ok(row); const buttons=elements(row.props.children).filter(e=>e.type==='button');buttons[0].props.onClick!();
 data={...data,config:JSON.parse(JSON.stringify(normalizeDashboardPayload(data).config))};
 assert.deepEqual(data.config.section_order,['creative_performance','kpi_grid']);
 assert.equal(creativeControl(render()).props.checked,true);
});
test('creative controls are absent for isolated dashboard editors',()=>{
 for(const dashboard_type of ['abbott_bi','zaruku_bi'] as const) assert.doesNotMatch(renderToStaticMarkup(Step({data:{...fixture(),dashboard_type},onChange:()=>{}})),/Creative performance \/ Креативы/);
});

test('creative column preset and checkbox selection survive API normalization and reload',()=>{
 let data=fixture();const render=()=>Step({data,onChange:next=>{data=next;}});
 const preset=elements(render()).find(e=>e.type==='button'&&Children.toArray(e.props.children).includes('Size, impressions, CTR / Размер, показы, CTR'));
 assert.ok(preset);preset.props.onClick!();
 data={...data,config:JSON.parse(JSON.stringify(normalizeDashboardPayload(data).config))};
 assert.deepEqual(data.config.section_field_overrides?.creative_performance?.visible_fields,['size','impressions','ctr']);
 const panel=elements(render()).find(e=>e.type==='div'&&elements(e.props.children).some(c=>c.type==='h5'&&Children.toArray(c.props.children).includes('Creative performance columns / Колонки креативов'))&&elements(e.props.children).filter(c=>c.type==='input').length===10);
 assert.ok(panel);
 const inputs=elements(panel.props.children).filter(e=>e.type==='input');assert.equal(inputs.filter(e=>e.props.checked).length,3);
 inputs[6].props.onChange!({target:{checked:true}});
 data={...data,config:JSON.parse(JSON.stringify(normalizeDashboardPayload(data).config))};
 assert.deepEqual(data.config.section_field_overrides?.creative_performance?.visible_fields,['size','impressions','ctr','clicks']);
});

test('Plus toggle and preview columns persist separately from original table',()=>{
 let data=fixture();const render=()=>Step({data,onChange:next=>{data=next;}});
 const label=()=>elements(render()).find(e=>e.type==='label'&&Children.toArray(e.props.children).includes('Эффективность креативов +'));
 assert.ok(label());const toggle=()=>elements(label()!.props.children).find(e=>e.type==='input')!;
 assert.equal(toggle().props.checked,false);toggle().props.onChange!({target:{checked:true}});
 data={...data,config:JSON.parse(JSON.stringify(normalizeDashboardPayload(data).config))};
 assert.equal(data.config.show_creative_performance_plus,true);assert.equal(toggle().props.checked,true);
 assert.ok(data.config.section_order?.includes('creative_performance_plus'));assert.equal(creativeControl(render()).props.checked,true);
 const panel=elements(render()).find(e=>e.type==='div'&&elements(e.props.children).some(c=>c.type==='h5'&&Children.toArray(c.props.children).includes('Эффективность креативов + — колонки'))&&elements(e.props.children).filter(c=>c.type==='input').length===11);
 assert.ok(panel);const inputs=elements(panel.props.children).filter(e=>e.type==='input');assert.equal(inputs[10].props.checked,true);inputs[10].props.onChange!({target:{checked:false}});
 data={...data,config:JSON.parse(JSON.stringify(normalizeDashboardPayload(data).config))};
 assert.ok(!data.config.section_field_overrides?.creative_performance_plus?.visible_fields.includes('preview'));
 assert.ok(!data.config.section_field_overrides?.creative_performance?.visible_fields.includes('preview'));
});
