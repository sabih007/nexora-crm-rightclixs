// src/models/Domain.ts
import { Schema, model, models, Types } from 'mongoose';

export interface IDomain {
  name: string;
  registrationDate?: Date;
  expirationDate?: Date;
  autoRenew?: boolean;
  status?: string[];
  client?: Types.ObjectId;
  lastSyncedAt?: Date;
}

const DomainSchema = new Schema<IDomain>({
  name:             { type: String, unique: true, index: true, required: true },
  registrationDate: Date,
  expirationDate:   { type: Date, index: true },
  autoRenew:        Boolean,
  status:           [String],
  client:           { type: Schema.Types.ObjectId, ref: 'Client' },
  lastSyncedAt:     Date,
}, { timestamps: true });

// `models.Domain ||` prevents "OverwriteModelError" on hot reload (Next.js)
export const Domain = models.Domain || model<IDomain>('Domain', DomainSchema);