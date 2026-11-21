import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { type BranchEntryLike, branchModelSelection } from "#src/session/recorded-model";
import { makeModel } from "#test/helpers/make-model";

const physical = makeModel({ provider: "openai", id: "gpt" });
const router = makeModel({ provider: "router", id: "auto", api: "pi-virtual" });
const catalog: Model<any>[] = [physical, router];
const registry = {
  find: (provider: string, modelId: string) =>
    catalog.find((model) => model.provider === provider && model.id === modelId),
};

const user: BranchEntryLike = { type: "message", message: { role: "user" } };
const reply = (provider: string, model: string, api = "openai-responses"): BranchEntryLike => ({
  type: "message",
  message: { role: "assistant", provider, model, api },
});
const change = (provider: string, modelId: string): BranchEntryLike => ({ type: "model_change", provider, modelId });

describe("branchModelSelection", () => {
  it("selects nothing on a branch with no reply and no model change", () => {
    expect(branchModelSelection([user], registry)).toBeUndefined();
  });

  it("selects the model that last replied", () => {
    expect(branchModelSelection([user, reply("anthropic", "claude"), user, reply("openai", "gpt")], registry)).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });

  it("selects a model change after the last reply", () => {
    expect(branchModelSelection([reply("openai", "gpt"), change("anthropic", "claude")], registry)).toEqual({
      provider: "anthropic",
      modelId: "claude",
    });
  });

  it("keeps a virtual model selected over the physical model that answered under it", () => {
    expect(branchModelSelection([change("router", "auto"), user, reply("openai", "gpt")], registry)).toEqual({
      provider: "router",
      modelId: "auto",
    });
  });

  it("lets a physical reply win over a physical model change before it", () => {
    expect(branchModelSelection([change("anthropic", "claude"), reply("openai", "gpt")], registry)).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });

  it("lets a virtual model the registry no longer knows fall back to the reply", () => {
    expect(branchModelSelection([change("router", "retired"), reply("openai", "gpt")], registry)).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });

  it("skips a reply whose routing failed, which still names the virtual model", () => {
    expect(branchModelSelection([reply("openai", "gpt"), reply("router", "auto", "pi-virtual")], registry)).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });

  describe("agreement with Pi's own selection", () => {
    // Pi does not export the rule this module mirrors, so the oracle is read
    // from the installed SDK's own module, beside the entry its exports name.
    async function piSelection() {
      const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
      const module = (await import(new URL("./core/virtual-models.js", entry).href)) as {
        getBranchSelection: (
          branch: readonly BranchEntryLike[],
          getModel: (provider: string, modelId: string) => Model<any> | undefined,
        ) => { provider: string; modelId: string } | undefined;
      };
      return module.getBranchSelection;
    }

    const vocabulary: BranchEntryLike[] = [
      user,
      reply("openai", "gpt"),
      reply("anthropic", "claude"),
      reply("router", "auto", "pi-virtual"),
      change("router", "auto"),
      change("router", "retired"),
      change("anthropic", "claude"),
    ];

    /** Every branch of up to `length` entries drawn from the vocabulary. */
    function branches(length: number): BranchEntryLike[][] {
      if (length === 0) return [[]];
      const shorter = branches(length - 1);
      return [...shorter, ...shorter.filter((b) => b.length === length - 1).flatMap((b) => vocabulary.map((e) => [...b, e]))];
    }

    it("selects what Pi selects, for every branch of up to four entries", async () => {
      const getBranchSelection = await piSelection();
      const all = branches(4);
      const disagreements = all.filter(
        (branch) =>
          JSON.stringify(branchModelSelection(branch, registry)) !==
          JSON.stringify(getBranchSelection(branch, registry.find)),
      );

      expect(all.length).toBe(2801);
      expect(disagreements).toEqual([]);
    });
  });
});
