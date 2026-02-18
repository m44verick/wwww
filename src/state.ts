export interface ConversationState {
  company_name?: string;
  country_city?: string;
  product_category?: string;
  usage?: string;
  size_mm_or_ligne?: string;
  type_variant?: string;
  color_finish?: string;
  quantity?: string;
  compliance_needs?: string;
  delivery_urgency?: string;
  sample_request?: string;
  branding_logo_need?: string;
  last_intent?: string;
  updated_at?: string;
}

export interface StateStore {
  get(phone: string): Promise<ConversationState>;
  merge(phone: string, partial: Partial<ConversationState>): Promise<ConversationState>;
}

export class InMemoryStateStore implements StateStore {
  private readonly map = new Map<string, ConversationState>();

  async get(phone: string): Promise<ConversationState> {
    return this.map.get(phone) ?? {};
  }

  async merge(phone: string, partial: Partial<ConversationState>): Promise<ConversationState> {
    const merged: ConversationState = {
      ...(this.map.get(phone) ?? {}),
      ...partial,
      updated_at: new Date().toISOString(),
    };

    this.map.set(phone, merged);
    return merged;
  }
}
