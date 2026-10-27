import {
  ArrowLeftRightIcon,
  AstroidIcon,
  BarChart3Icon,
  BotIcon,
  CogIcon,
  DatabaseIcon,
  HeartHandshakeIcon,
  KeyIcon,
  KeyRoundIcon,
  LibraryIcon,
  type LucideIcon,
  MailIcon,
  Settings2Icon,
  SmartphoneIcon,
  TagsIcon,
  UserIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react";
import { type ComponentType } from "react";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { lazyWithReload } from "@/utils/lazy";

// Sidebar navigation reads this catalogue without loading every settings screen.
const AccessTokenSection = lazyWithReload(() => import("@/components/Settings/AccessTokenSection"));
const AgentSection = lazyWithReload(() => import("@/components/Settings/AgentSection"));
const AISection = lazyWithReload(() => import("@/components/Settings/AISection"));
const InstallAppSection = lazyWithReload(() => import("@/components/Settings/InstallAppSection"));
const InstanceSection = lazyWithReload(() => import("@/components/Settings/InstanceSection"));
const MemberSection = lazyWithReload(() => import("@/components/Settings/MemberSection"));
const MemoExportSection = lazyWithReload(() => import("@/components/Settings/MemoExportSection"));
const MemoRelatedSettings = lazyWithReload(() => import("@/components/Settings/MemoRelatedSettings"));
const MyAccountSection = lazyWithReload(() => import("@/components/Settings/MyAccountSection"));
const NotificationSection = lazyWithReload(() => import("@/components/Settings/NotificationSection"));
const PreferencesSection = lazyWithReload(() => import("@/components/Settings/PreferencesSection"));
const ResourceStatsSection = lazyWithReload(() => import("@/components/Settings/ResourceStatsSection"));
const SpacesSection = lazyWithReload(() => import("@/components/Settings/SpacesSection"));
const SSOSection = lazyWithReload(() => import("@/components/Settings/SSOSection"));
const StorageSection = lazyWithReload(() => import("@/components/Settings/StorageSection"));
const TagsSection = lazyWithReload(() => import("@/components/Settings/TagsSection"));
const WebhookSection = lazyWithReload(() => import("@/components/Settings/WebhookSection"));

export type SettingSectionKey =
  | "my-account"
  | "memo-export"
  | "spaces"
  | "access-token"
  | "agent"
  | "preference"
  | "install-app"
  | "webhook"
  | "member"
  | "system"
  | "memo"
  | "storage"
  | "notification"
  | "sso"
  | "tags"
  | "ai"
  | "resource-stats";

type SettingSectionScope = "basic" | "admin";

export interface SettingSectionDefinition {
  key: SettingSectionKey;
  scope: SettingSectionScope;
  labelKey: `setting.${SettingSectionKey}.label`;
  icon: LucideIcon;
  component: ComponentType;
  preloadSettingKeys?: InstanceSetting_Key[];
}

export const SETTINGS_SECTIONS: SettingSectionDefinition[] = [
  {
    key: "install-app",
    scope: "basic",
    labelKey: "setting.install-app.label",
    icon: SmartphoneIcon,
    component: InstallAppSection,
  },
  {
    key: "my-account",
    scope: "basic",
    labelKey: "setting.my-account.label",
    icon: UserIcon,
    component: MyAccountSection,
  },
  {
    key: "spaces",
    scope: "basic",
    labelKey: "setting.spaces.label",
    icon: AstroidIcon,
    component: SpacesSection,
  },
  {
    key: "access-token",
    scope: "basic",
    labelKey: "setting.access-token.label",
    icon: KeyRoundIcon,
    component: AccessTokenSection,
  },
  {
    key: "agent",
    scope: "basic",
    labelKey: "setting.agent.label",
    icon: BotIcon,
    component: AgentSection,
  },
  {
    key: "preference",
    scope: "basic",
    labelKey: "setting.preference.label",
    icon: CogIcon,
    component: PreferencesSection,
  },
  {
    key: "webhook",
    scope: "basic",
    labelKey: "setting.webhook.label",
    icon: WebhookIcon,
    component: WebhookSection,
  },
  {
    key: "member",
    scope: "admin",
    labelKey: "setting.member.label",
    icon: UsersIcon,
    component: MemberSection,
  },
  {
    key: "system",
    scope: "admin",
    labelKey: "setting.system.label",
    icon: Settings2Icon,
    component: InstanceSection,
  },
  {
    key: "memo",
    scope: "admin",
    labelKey: "setting.memo.label",
    icon: LibraryIcon,
    component: MemoRelatedSettings,
  },
  {
    key: "tags",
    scope: "basic",
    labelKey: "setting.tags.label",
    icon: TagsIcon,
    component: TagsSection,
  },
  {
    key: "memo-export",
    scope: "basic",
    labelKey: "setting.memo-export.label",
    icon: ArrowLeftRightIcon,
    component: MemoExportSection,
  },
  {
    key: "storage",
    scope: "admin",
    labelKey: "setting.storage.label",
    icon: DatabaseIcon,
    component: StorageSection,
    preloadSettingKeys: [InstanceSetting_Key.STORAGE],
  },
  {
    key: "notification",
    scope: "admin",
    labelKey: "setting.notification.label",
    icon: MailIcon,
    component: NotificationSection,
    preloadSettingKeys: [InstanceSetting_Key.NOTIFICATION],
  },
  {
    key: "sso",
    scope: "admin",
    labelKey: "setting.sso.label",
    icon: KeyIcon,
    component: SSOSection,
  },
  {
    key: "ai",
    scope: "admin",
    labelKey: "setting.ai.label",
    icon: HeartHandshakeIcon,
    component: AISection,
    preloadSettingKeys: [InstanceSetting_Key.AI],
  },
  {
    key: "resource-stats",
    scope: "admin",
    labelKey: "setting.resource-stats.label",
    icon: BarChart3Icon,
    component: ResourceStatsSection,
  },
];

export const DEFAULT_SETTING_SECTION: SettingSectionKey = "my-account";

export const isSettingSectionKey = (value: string): value is SettingSectionKey => {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
};
