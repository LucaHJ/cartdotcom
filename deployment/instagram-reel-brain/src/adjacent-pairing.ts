import {
  adjacentInstructionApplication,
  queueDelaySecondsForAdjacentInstruction,
  type AdjacentPairingTargetState,
} from "./domain";

export type AdjacentPendingShare = {
  source_message_id: string;
};

export type AdjacentPendingInstruction = {
  source_message_id: string;
  instructions: string | null;
};

export type AdjacentQueue = {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown>;
};

export type AdjacentPairingStore = {
  takePendingShare(senderId: string): Promise<AdjacentPendingShare | null>;
  takePendingInstruction(senderId: string): Promise<AdjacentPendingInstruction | null>;
  storePendingInstruction(input: { senderId: string; instructionMessageId: string; instructions: string }): Promise<void>;
  markInstructionWaiting(input: { instructionMessageId: string; result: Record<string, unknown> }): Promise<void>;
  applyPendingInstructionToShare(input: {
    shareMessageId: string;
    instructionMessageId: string;
    instructions: string;
    result: Record<string, unknown>;
    originalSummary: Record<string, unknown>;
  }): Promise<void>;
  readTargetState(shareMessageId: string): Promise<AdjacentPairingTargetState>;
  applyInstruction(input: {
    shareMessageId: string;
    instructionMessageId: string;
    instructions: string;
    late: boolean;
    correctiveAction: "explicit_resynthesis_required" | null;
    result: Record<string, unknown>;
    originalSummary: Record<string, unknown>;
  }): Promise<void>;
};

export function queueOptionsForAdjacentInstruction(mode: string): { delaySeconds: number } | undefined {
  const delaySeconds = queueDelaySecondsForAdjacentInstruction(mode);
  return delaySeconds > 0 ? { delaySeconds } : undefined;
}

export async function sendQueueMessageWithAdjacentInstructionDelay(
  queue: AdjacentQueue,
  message: unknown,
  mode: string,
): Promise<void> {
  await queue.send(message, queueOptionsForAdjacentInstruction(mode));
}

export async function takePendingInstructionForShare(
  store: Pick<AdjacentPairingStore, "takePendingInstruction" | "applyPendingInstructionToShare">,
  input: { senderId: string; shareMessageId: string },
): Promise<string | null> {
  const pendingInstruction = await store.takePendingInstruction(input.senderId);
  if (!pendingInstruction?.instructions) return null;
  const result = { ok: true, paired_with: input.shareMessageId, kind: "adjacent_instruction", late: false };
  await store.applyPendingInstructionToShare({
    shareMessageId: input.shareMessageId,
    instructionMessageId: pendingInstruction.source_message_id,
    instructions: pendingInstruction.instructions,
    result,
    originalSummary: {
      instruction_source_message_id: pendingInstruction.source_message_id,
      instruction_text: pendingInstruction.instructions,
      late: false,
    },
  });
  return pendingInstruction.instructions;
}

export async function pairLiveInstructionWithPendingShare(
  store: Pick<AdjacentPairingStore, "takePendingShare" | "storePendingInstruction" | "markInstructionWaiting" | "readTargetState" | "applyInstruction">,
  input: { senderId: string; instructionMessageId: string; instructions: string },
): Promise<{ paired: boolean; shareMessageId?: string; late?: boolean; result: Record<string, unknown> }> {
  const pendingShare = await store.takePendingShare(input.senderId);
  if (!pendingShare) {
    await store.storePendingInstruction(input);
    const waiting = { ok: true, silent: true, waiting_for: "adjacent_instagram_share", message_id: input.instructionMessageId };
    await store.markInstructionWaiting({ instructionMessageId: input.instructionMessageId, result: waiting });
    return { paired: false, result: waiting };
  }

  const application = adjacentInstructionApplication(await store.readTargetState(pendingShare.source_message_id));
  const result = {
    ok: true,
    paired_with: pendingShare.source_message_id,
    kind: "adjacent_instruction",
    late: application.late,
    corrective_action: application.correctiveAction,
  };
  const originalSummary = {
    instruction_source_message_id: input.instructionMessageId,
    instruction_text: input.instructions,
    late: application.late,
    corrective_action: application.correctiveAction,
  };

  await store.applyInstruction({
    shareMessageId: pendingShare.source_message_id,
    instructionMessageId: input.instructionMessageId,
    instructions: input.instructions,
    late: application.late,
    correctiveAction: application.correctiveAction,
    result,
    originalSummary,
  });
  return { paired: true, shareMessageId: pendingShare.source_message_id, late: application.late, result };
}
