/**
 * Deployment agent — controlled pipeline, never raw shell deploy from model.
 *
 * Build → Tests → Security checks → Diff → Plan → Approval → Deploy → Health → Rollback
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';
import { approvalService } from '../../core/approval.js';
import { randomUUID } from 'node:crypto';

export const DEPLOYMENT_MANIFEST: AgentManifest = {
  id: 'deployment',
  name: 'Deployment',
  description: 'Controlled deployment with mandatory plan and approval',
  allowedCapabilities: ['deployment.request', 'deployment.execute', 'process.execute', 'security.inspect'],
  maxToolCalls: 25,
  maxTaskDurationMs: 30 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 180_000,
};

export interface DeploymentInput {
  userId: string;
  objective: string;
  projectPath: string;
  environment: 'staging' | 'production';
  approvalId?: string;
  planId?: string;
}

export interface DeploymentOutput {
  taskId: string;
  status: string;
  summary: string;
  planId?: string;
  approvalId?: string;
  healthOk?: boolean;
}

export async function runDeployment(input: DeploymentInput): Promise<DeploymentOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'deployment',
    manifest: DEPLOYMENT_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });

  try {
    assertNotExpired(task);

    // 1. Plan
    addStep(task.taskId, {
      agentId: 'deployment',
      description: 'Create deployment plan',
      status: 'running',
      capability: 'deployment.request',
    });
    const planId = input.planId || randomUUID();
    const plan = await callTool({
      toolName: 'deployment.plan',
      agentId: 'deployment',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'deployment.request',
      scope: input.environment,
      reason: input.objective,
      args: {
        planId,
        environment: input.environment,
        projectPath: input.projectPath,
      },
    });
    if (!plan.ok) {
      updateTask(task.taskId, { status: 'failed', error: plan.error?.message });
      return { taskId: task.taskId, status: 'failed', summary: plan.error?.message || 'plan failed' };
    }

    // 2. Approval for execute
    if (!input.approvalId) {
      const approval = approvalService.create({
        taskId: task.taskId,
        agentId: 'deployment',
        capability: 'deployment.execute',
        reason: input.objective,
        summary: `Deploy to ${input.environment}: ${input.objective.slice(0, 160)}`,
        scope: input.environment,
      });
      updateTask(task.taskId, { status: 'waiting_approval' });
      return {
        taskId: task.taskId,
        status: 'waiting_approval',
        summary: `Human approval required for ${input.environment} deploy`,
        planId,
        approvalId: approval.id,
      };
    }

    // 3. Execute (only with approval)
    addStep(task.taskId, {
      agentId: 'deployment',
      description: 'Execute deployment',
      status: 'running',
      capability: 'deployment.execute',
    });
    const deployed = await callTool({
      toolName: 'deployment.execute',
      agentId: 'deployment',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'deployment.execute',
      scope: input.environment,
      reason: input.objective,
      args: {
        planId,
        approvalId: input.approvalId,
        environment: input.environment,
      },
    });
    if (!deployed.ok) {
      updateTask(task.taskId, { status: 'failed', error: deployed.error?.message });
      return {
        taskId: task.taskId,
        status: 'failed',
        summary: deployed.error?.message || 'deploy failed',
        planId,
        approvalId: input.approvalId,
      };
    }

    // 4. Health check
    addStep(task.taskId, {
      agentId: 'deployment',
      description: 'Health check',
      status: 'running',
      capability: 'deployment.request',
    });
    const health = await callTool({
      toolName: 'deployment.health',
      agentId: 'deployment',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'deployment.request',
      scope: input.environment,
      reason: 'Post-deploy verification',
      args: { environment: input.environment, planId },
    });
    const healthOk = health.ok === true;

    updateTask(task.taskId, {
      status: healthOk ? 'completed' : 'failed',
      resultSummary: healthOk ? 'Deploy + health OK' : 'Deployed but health check failed',
    });
    return {
      taskId: task.taskId,
      status: healthOk ? 'completed' : 'failed',
      summary: healthOk ? 'Deployment successful' : 'Health check failed — investigate rollback',
      planId,
      approvalId: input.approvalId,
      healthOk,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'deployment failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg };
  }
}

export default { manifest: DEPLOYMENT_MANIFEST, run: runDeployment };
