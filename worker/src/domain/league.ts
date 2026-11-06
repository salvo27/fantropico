// Regole della lega (aggregato con radice League) e testi fissi decisi dal codice, non dal modello

import type { DailyLimit, JoinCode, LeagueId, MemberId, Role } from "./primitives";

export const MAX_ACTIVE_MEMBERS = 40;

export interface League {
  readonly id: LeagueId;
  readonly name: string;
  readonly joinCode: JoinCode;
  readonly dailyLimit: DailyLimit;
  readonly injuryCheckEnabled: boolean;
}

export type MemberStatus = "active" | "removed";

export interface Member {
  readonly id: MemberId;
  readonly leagueId: LeagueId;
  readonly name: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly tokenVersion: number;
}

export type AuditAction =
  | "league_created"
  | "rulebook_updated"
  | "api_key_updated"
  | "settings_updated"
  | "join_code_regenerated"
  | "member_joined"
  | "member_removed"
  | "admin_login"
  | "admin_password_changed";

export const NOT_COVERED_TEXT = "Il regolamento non lo prevede, chiedi all'admin.";
export const ADMIN_DECIDES_TEXT = "Sui casi controversi la decisione finale spetta all'admin.";
export const ADMIN_CONFIRMS_TEXT = "La conferma finale spetta all'admin.";
export const INJURY_NOT_FOUND_TEXT = "Non ho trovato informazioni chiare su fantacalcio.it, chiedi all'admin.";
