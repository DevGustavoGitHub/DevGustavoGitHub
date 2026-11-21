import type { GameModule } from '../core/module';
// STUB — pertence ao agente de "audio".
export default function create(): GameModule {
  return { name: 'audio', init() {}, update() {} };
}
