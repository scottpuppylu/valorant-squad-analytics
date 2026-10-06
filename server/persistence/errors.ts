/** Thrown by durable persistence when a provider match lacks the consenting account (e.g. an older Riot ID). */
export class ConsentingParticipantAbsentError extends Error {
  constructor() { super('Consenting participant is absent from provider evidence.'); this.name = 'ConsentingParticipantAbsentError'; }
}
