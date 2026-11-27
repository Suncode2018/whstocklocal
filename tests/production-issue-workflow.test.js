'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {workflowFor}=require('../src/services/production-issue-progress');

const stateOf=(workflow,code)=>workflow.steps.find(step=>step.code===code).state;

test('draft production issue waits for picking and offers the pick action',()=>{
 const workflow=workflowFor('DRAFT');
 assert.equal(workflow.status,'WAITING');
 assert.equal(workflow.label,'รอเบิก');
 assert.equal(workflow.nextAction,'PICK');
 assert.equal(stateOf(workflow,'CREATED'),'DONE');
 assert.equal(stateOf(workflow,'WAITING'),'CURRENT');
 assert.equal(stateOf(workflow,'PICKING'),'PENDING');
 assert.equal(stateOf(workflow,'COMPLETED'),'PENDING');
});

test('partially picked production issue is in progress and remains pickable',()=>{
 const workflow=workflowFor('PARTIAL');
 assert.equal(workflow.status,'PICKING');
 assert.equal(workflow.label,'กำลังเบิก');
 assert.equal(workflow.nextAction,'PICK');
 assert.equal(stateOf(workflow,'WAITING'),'DONE');
 assert.equal(stateOf(workflow,'PICKING'),'CURRENT');
 assert.equal(stateOf(workflow,'COMPLETED'),'PENDING');
});

test('fully picked production issue is complete and no longer offers the pick action',()=>{
 const workflow=workflowFor('ISSUED');
 assert.equal(workflow.status,'COMPLETED');
 assert.equal(workflow.label,'เบิกครบแล้ว');
 assert.equal(workflow.nextAction,null);
 assert.equal(stateOf(workflow,'PICKING'),'DONE');
 assert.equal(stateOf(workflow,'COMPLETED'),'DONE');
});

test('cancelled production issue is terminal and skips remaining steps',()=>{
 const workflow=workflowFor('CANCELLED');
 assert.equal(workflow.status,'CANCELLED');
 assert.equal(workflow.label,'ยกเลิก');
 assert.equal(workflow.nextAction,null);
 assert.equal(stateOf(workflow,'WAITING'),'SKIPPED');
 assert.equal(stateOf(workflow,'PICKING'),'SKIPPED');
 assert.equal(stateOf(workflow,'COMPLETED'),'SKIPPED');
});
