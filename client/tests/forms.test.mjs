// Submission regressions run entirely in memory. GPL-3.0-or-later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitForm } from '../src/forms.js';

function fixture(){
  const attributes=new Map(),buttons=[{disabled:false},{disabled:true}],error={textContent:'Previous error'};
  const form={
    getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
    querySelectorAll:()=>buttons,querySelector:()=>error,
  };
  return {form,buttons,error};
}

test('submitting a form once blocks repeated clicks and Enter submissions until completion',async()=>{
  const {form,buttons,error}=fixture();let complete,calls=0;
  const pending=submitForm(form,()=>{calls++;return new Promise(resolve=>complete=resolve);});
  assert.equal(form.getAttribute('aria-busy'),'true');assert.ok(buttons.every(button=>button.disabled));assert.equal(error.textContent,'');
  await submitForm(form,()=>calls++);assert.equal(calls,1);
  complete('saved');assert.equal(await pending,'saved');
  assert.equal(form.getAttribute('aria-busy'),undefined);assert.deepEqual(buttons.map(button=>button.disabled),[false,true]);
  await submitForm(form,()=>calls++);assert.equal(calls,2);
});

test('failed submissions restore controls, propagate the error, and allow a retry',async()=>{
  const {form,buttons}=fixture(),failure=new Error('Server unavailable');
  await assert.rejects(submitForm(form,()=>{throw failure;}),failure);
  assert.equal(form.getAttribute('aria-busy'),undefined);assert.equal(buttons[0].disabled,false);
  assert.equal(await submitForm(form,async()=>42),42);
});
