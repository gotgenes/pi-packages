import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCiFind } from "./tools/ci-find";
import { registerCiList } from "./tools/ci-list";
import { registerCiWatch } from "./tools/ci-watch";
import { registerIssueClose } from "./tools/issue-close";

export default function piGithubToolsExtension(pi: ExtensionAPI): void {
  registerCiFind(pi);
  registerCiWatch(pi);
  registerCiList(pi);
  registerIssueClose(pi);
}
