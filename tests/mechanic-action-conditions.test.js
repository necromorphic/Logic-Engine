import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMechanicActionConditions } from '../src/core/mechanics.js';
function template(overrides = {}) { return {
  template_id:'test.mechanic',version:'1.0.0',schema_version:'1',display_name:'Condition test',required_capabilities:[],
  applicability:[{op:'eq',path:'world.enabled',value:true}],
  actions:[{action_id:'act',input_schema:{},preconditions:[{op:'eq',path:'actor.alive',value:true}],constraints:[{op:'eq',path:'target.present',value:true}],effects:[],ambiguity_policy:'deterministic_only'}],
  conflict_policy:{mode:'manual'},lifecycle_policy:{on_disable:'pause_blocked'},unknown_policy:'mark_unknown',...overrides
};}
test('mechanic action conditions aggregate true only when every checked condition is true',()=>{const r=evaluateMechanicActionConditions(template(),'act',{world:{enabled:true},actor:{alive:true},target:{present:true}});assert.equal(r.status,'true');assert.equal(r.reason_code,null);assert.deepEqual(r.condition_results.map(x=>x.scope),['applicability','action.preconditions','action.constraints']);assert.deepEqual(r.unknown_paths,[]);});
test('a false condition dominates unknown while unknown paths remain visible',()=>{const r=evaluateMechanicActionConditions(template(),'act',{world:{enabled:false},actor:{alive:true}});assert.equal(r.status,'false');assert.equal(r.reason_code,'MECHANIC_CONDITION_NOT_SATISFIED');assert.deepEqual(r.unknown_paths,['target.present']);});
test('missing condition context remains unknown rather than being treated as false or true',()=>{const r=evaluateMechanicActionConditions(template(),'act',{});assert.equal(r.status,'unknown');assert.equal(r.reason_code,'MECHANIC_CONDITION_CONTEXT_UNKNOWN');assert.deepEqual(r.unknown_paths,['actor.alive','target.present','world.enabled']);});
test('known absence is an explicit caller assertion and only resolves the named path',()=>{const r=evaluateMechanicActionConditions(template({applicability:[],actions:[{action_id:'act',input_schema:{},preconditions:[{op:'exists',path:'actor.cover'}],effects:[],ambiguity_policy:'deterministic_only'}]}),'act',{}, {knownAbsentPaths:['actor.cover']});assert.equal(r.status,'false');assert.deepEqual(r.unknown_paths,[]);});
test('unknown action is rejected without claiming feasibility',()=>{const r=evaluateMechanicActionConditions(template(),'missing',{});assert.equal(r.status,'rejected');assert.equal(r.reason_code,'MECHANIC_ACTION_NOT_FOUND');assert.deepEqual(r.condition_results,[]);});
