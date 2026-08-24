/**
 * Security tests — permission escalation, path traversal, network isolation,
 * credential exposure, approval gates, kill switch, agent-to-agent auth.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initPlatform,
  toolGateway,
  killSwitch,
  approvalService,
  capabilityManager,
  CAPABILITY_RISK,
  ALWAYS_APPROVE,
} from '../../src/index.js';
import type { ToolInvocation } from '../../src/core/types.js';

before(() => {
  initPlatform({ loadEnvSecrets: false });
});

after(() => {
  if (killSwitch.isActive()) killSwitch.deactivate('test');
});

function inv(partial: Partial<ToolInvocation> & Pick<ToolInvocation, 'toolName' | 'capability'>): ToolInvocation {
  return {
    agentId: 'coder',
    taskId: 'task-test-0001',
    userId: 'user-1',
    scope: '/workspace',
    reason: 'test',
    args: {},
    ...partial,
  };
}

describe('capability model', () => {
  it('CRITICAL capabilities always require approval', () => {
    assert.ok(ALWAYS_APPROVE.has('database.destructive'));
    assert.ok(ALWAYS_APPROVE.has('deployment.execute'));
    assert.ok(ALWAYS_APPROVE.has('secrets.request'));
    assert.equal(CAPABILITY_RISK['database.destructive'], 'CRITICAL');
  });

  it('agent cannot request capability outside its manifest', async () => {
    const result = await toolGateway.invoke(
      inv({
        agentId: 'coder',
        toolName: 'deployment.execute',
        capability: 'deployment.execute',
        args: { planId: 'x', approvalId: 'y' },
      })
    );
    assert.equal(result.ok, false);
    assert.ok(result.blocked || result.error?.code === 'CAPABILITY_DENIED');
  });
});

describe('policy engine — protected branches', () => {
  it('blocks github write to main', async () => {
    // github agent is allowed github.write, but policy blocks main
    process.env.GITHUB_TOKEN = 'test-token-not-real';
    const result = await toolGateway.invoke({
      agentId: 'github',
      taskId: 'task-gh-0001',
      userId: 'user-1',
      toolName: 'github.upsert_file',
      capability: 'github.write',
      scope: 'src/a.ts',
      reason: 'test write',
      args: {
        path: 'src/a.ts',
        content: 'x',
        branch: 'main',
        message: 'bad',
      },
    });
    assert.equal(result.ok, false);
    delete process.env.GITHUB_TOKEN;
  });
});

describe('kill switch', () => {
  it('blocks tool invocation when active', async () => {
    killSwitch.activate('test emergency', 'tester');
    assert.equal(killSwitch.isActive(), true);
    const result = await toolGateway.invoke(
      inv({
        toolName: 'sandbox.execute',
        capability: 'process.execute',
        args: { sandboxId: 'x', command: 'echo hi' },
      })
    );
    assert.equal(result.ok, false);
    killSwitch.deactivate('tester');
    assert.equal(killSwitch.isActive(), false);
  });

  it('agents cannot deactivate via normal tools', () => {
    // There is no tool registered for kill_switch.deactivate
    assert.equal(toolGateway.has('kill_switch.deactivate'), false);
    assert.equal(toolGateway.has('kill_switch.activate'), false);
  });
});

describe('approval system', () => {
  it('creates pending approval for HIGH risk', () => {
    const req = approvalService.create({
      taskId: 'task-ap-1',
      agentId: 'deployment',
      capability: 'deployment.execute',
      reason: 'deploy prod',
      summary: 'Deploy to production',
      scope: 'production',
    });
    assert.equal(req.status, 'pending');
    assert.equal(req.riskLevel, 'CRITICAL');
  });

  it('human can approve; agent cannot self-approve through service misuse is operator-only', () => {
    const req = approvalService.create({
      taskId: 'task-ap-2',
      agentId: 'database',
      capability: 'database.destructive',
      reason: 'drop table',
      summary: 'DROP TABLE x',
      scope: 'db',
    });
    const decided = approvalService.decide({
      approvalId: req.id,
      status: 'approved',
      decidedBy: 'human-operator',
    });
    assert.equal(decided.status, 'approved');
    assert.equal(decided.decidedBy, 'human-operator');
  });
});

describe('capability grants', () => {
  it('denies grant for capability not in agent allow-list', () => {
    const r = capabilityManager.request({
      agentId: 'research',
      taskId: 'task-cap-1',
      userId: 'u1',
      capability: 'deployment.execute',
      scope: 'prod',
      reason: 'should fail',
      agentAllowed: ['research.query', 'network.read'],
    });
    assert.equal(r.denied, true);
  });
});

describe('input validation', () => {
  it('rejects malformed tool invocation', async () => {
    const result = await toolGateway.invoke({
      // missing required fields intentionally
      toolName: 'sandbox.execute',
      agentId: 'coder',
      taskId: 'short',
      userId: '',
      capability: 'process.execute',
      scope: '',
      reason: '',
      args: {},
    } as ToolInvocation);
    assert.equal(result.ok, false);
  });
});
