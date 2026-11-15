import { Logger } from '../utils/logger.js';

export type WorkerState =
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'DRAINING'
  | 'STOPPING'
  | 'FAILED';

export interface StateTransitionRecord {
  from: WorkerState;
  to: WorkerState;
  reason: string;
  timestamp: string;
}

export class WorkerStateMachine {
  private currentState: WorkerState = 'STOPPED';
  private history: StateTransitionRecord[] = [];
  private logger = new Logger('WorkerStateMachine');

  constructor(initialState: WorkerState = 'STOPPED') {
    this.currentState = initialState;
  }

  public getState(): WorkerState {
    return this.currentState;
  }

  public canTransitionTo(nextState: WorkerState): boolean {
    if (this.currentState === nextState) return true;

    switch (this.currentState) {
      case 'STOPPED':
        return nextState === 'STARTING' || nextState === 'FAILED';

      case 'STARTING':
        return nextState === 'RUNNING' || nextState === 'FAILED' || nextState === 'STOPPED';

      case 'RUNNING':
        return nextState === 'DRAINING' || nextState === 'STOPPING' || nextState === 'FAILED';

      case 'DRAINING':
        return nextState === 'STOPPING' || nextState === 'STOPPED' || nextState === 'RUNNING';

      case 'STOPPING':
        return nextState === 'STOPPED' || nextState === 'FAILED';

      case 'FAILED':
        return nextState === 'STARTING' || nextState === 'STOPPED';

      default:
        return false;
    }
  }

  public transition(nextState: WorkerState, reason: string): boolean {
    if (this.currentState === nextState) {
      return true;
    }

    if (!this.canTransitionTo(nextState)) {
      this.logger.warn(
        `Invalid state transition rejected: ${this.currentState} -> ${nextState} (Reason: ${reason})`,
      );
      return false;
    }

    const from = this.currentState;
    this.currentState = nextState;

    const record: StateTransitionRecord = {
      from,
      to: nextState,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.history.push(record);
    if (this.history.length > 50) this.history.shift();

    this.logger.info(`Worker state transitioned: [${from}] -> [${nextState}] (${reason})`);
    return true;
  }

  public getHistory(): StateTransitionRecord[] {
    return [...this.history];
  }
}
