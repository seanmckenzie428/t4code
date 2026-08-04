import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AppViewId,
  AppViewRevision,
  type EnvironmentId,
  ThreadId,
  type NativeAppViewManifest,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  presentAppView,
  selectAppView,
  selectPersonalAppViews,
  useAppViewStore,
} from "./appViewStore";
import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";
import { selectThreadMainView, useMainViewStore } from "./mainViewStore";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));

const manifest = (revision = 1): NativeAppViewManifest => ({
  id: AppViewId.make("health"),
  revision: AppViewRevision.make(revision),
  title: "Workspace health",
  kind: "native",
  scope: { kind: "thread", threadId: ref.threadId },
  root: { id: "root", type: "text", value: "Healthy" },
});

beforeEach(() => {
  useAppViewStore.setState({
    byThreadKey: {},
    personalByEnvironment: {},
    projectPinProposals: {},
  });
  useRightPanelStore.setState({ byThreadKey: {} });
  useMainViewStore.setState({ byThreadKey: {} });
});

describe("appViewStore", () => {
  it("returns a stable empty personal-view snapshot for React store selectors", () => {
    const personalByEnvironment = useAppViewStore.getState().personalByEnvironment;

    expect(selectPersonalAppViews(personalByEnvironment, ref.environmentId)).toBe(
      selectPersonalAppViews(personalByEnvironment, ref.environmentId),
    );
  });

  it("persists a thread view and opens its dock surface immediately", () => {
    expect(presentAppView(ref, manifest())).toBe(true);
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toEqual(
      manifest(),
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "app-view:health",
      surfaces: [{ id: "app-view:health", kind: "app-view", viewId: "health" }],
    });
  });

  it("rejects cross-thread manifests and stale updates", () => {
    const otherThread = {
      ...manifest(),
      scope: { kind: "thread" as const, threadId: ThreadId.make("other") },
    };
    expect(presentAppView(ref, otherThread)).toBe(false);

    presentAppView(ref, manifest());
    expect(useAppViewStore.getState().update(ref, manifest(2), 0)).toBe(false);
    expect(useAppViewStore.getState().update(ref, manifest(2), 1)).toBe(true);
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")?.revision).toBe(2);
  });

  it("closing a surface does not delete or pin its manifest", () => {
    presentAppView(ref, manifest());
    useRightPanelStore.getState().closeSurface(ref, "app-view:health");

    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toEqual(
      manifest(),
    );
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")?.scope).toEqual({
      kind: "thread",
      threadId: ref.threadId,
    });
  });

  it("keeps pins while thread deletion removes only unpinned thread state", () => {
    presentAppView(ref, manifest());
    useMainViewStore.getState().select(ref, "review");
    expect(useAppViewStore.getState().pinPersonal(ref, "health")).toBe(true);
    useAppViewStore.getState().removeThread(ref);

    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toBeNull();
    expect(
      useAppViewStore.getState().personalByEnvironment[ref.environmentId]?.health,
    ).toBeDefined();
    expect(selectThreadMainView(useMainViewStore.getState().byThreadKey, ref)).toBe("chat");
  });

  it("reopens a personal view in the current thread", () => {
    presentAppView(ref, manifest());
    useAppViewStore.getState().pinPersonal(ref, "health");
    useAppViewStore.getState().removeThread(ref);

    expect(useAppViewStore.getState().openPersonal(ref, "health")).toBe(true);
    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")?.scope).toEqual({
      kind: "thread",
      threadId: ref.threadId,
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
    ).toBe("app-view:health");
  });

  it("includes ephemeral views and personal pins in restart persistence", () => {
    presentAppView(ref, manifest());
    useAppViewStore.getState().pinPersonal(ref, "health");

    const partialize = useAppViewStore.persist.getOptions().partialize;
    const persisted = partialize?.(useAppViewStore.getState()) as Partial<
      ReturnType<typeof useAppViewStore.getState>
    >;
    expect(selectAppView(persisted.byThreadKey ?? {}, ref, "health")).toEqual(manifest());
    expect(persisted.personalByEnvironment?.[ref.environmentId]?.health?.scope).toEqual({
      kind: "personal",
    });
  });

  it("destructive delete removes ephemeral and pinned copies", () => {
    presentAppView(ref, manifest());
    useAppViewStore.getState().pinPersonal(ref, "health");
    useAppViewStore.getState().remove(ref, "health");

    expect(selectAppView(useAppViewStore.getState().byThreadKey, ref, "health")).toBeNull();
    expect(useAppViewStore.getState().personalByEnvironment[ref.environmentId]).toBeUndefined();
  });
});
