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
