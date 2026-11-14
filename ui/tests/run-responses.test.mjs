import assert from 'node:assert/strict';
import test from 'node:test';
import { readRunList, readRunDetail } from '../src/api/runResponses.ts';

const run={runId:'r1',status:'SUCCEEDED',interrupted:false,submittedAt:'2026-10-19T12:00:00Z',
  triggeringMessageId:null,answerMessageId:null,modelName:'test-model'};
const event={sequence:1,type:'MODEL_CALL',status:'SUCCEEDED',startedAt:run.submittedAt,durationMs:120};

test('public nullable association and account association both retain their actual fields',()=>{
  const account={...run,sessionId:'s1',triggeringMessageId:'q1',answerMessageId:'a1'};
  assert.deepEqual(readRunList({runs:[run,account]}).runs,[run,account]);
  assert.deepEqual(readRunDetail({summary:run,events:[event]},'r1'),{summary:run,events:[event]});
});
test('malformed list entries are read errors and a later valid retry still succeeds',()=>{
  for(const entry of [null,{}, {...run,status:'UNKNOWN'}, {...run,modelName:{label:'broken'}}]){
    assert.throws(()=>readRunList({runs:[entry]}),/执行记录响应格式无效/);
  }
  assert.deepEqual(readRunList({runs:[run]}).runs,[run]);
});
test('a detail response cannot confirm a different run',()=>{
  assert.throws(()=>readRunDetail({summary:{...run,runId:'older'},events:[event]},'r1'),/执行详情响应格式无效/);
});
test('malformed timeline entries stay out of the render tree',()=>{
  for(const entry of [null,{...event,sequence:'1'},{...event,detail:{unsafe:'object'}}]){
    assert.throws(()=>readRunDetail({summary:run,events:[entry]},'r1'),/执行详情响应格式无效/);
  }
});
test('delivery repair and reference fallback events retain their recorded outcome and details',()=>{
  const events=[
    {...event,type:'DELIVERY_REPAIR',status:'FAILED',errorCode:'INVALID_ANSWER_FORMAT',detail:'attempt=1'},
    {...event,sequence:2,type:'ANSWER_FALLBACK',status:'SUCCEEDED',detail:'authorized-source-excerpts'},
  ];
  assert.deepEqual(readRunDetail({summary:run,events},'r1'),{summary:run,events});
});
test('adding known recovery events does not allow unknown event types',()=>{
  for(const type of ['UNKNOWN','ANSWER_FALLBACK_EXTRA','DELIVERY_REPAIR_EXTRA','',null]){
    assert.throws(()=>readRunDetail({summary:run,events:[{...event,type}]},'r1'),/执行详情响应格式无效/);
  }
});
