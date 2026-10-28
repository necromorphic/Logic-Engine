import importlib.util
import pathlib
import unittest
from unittest.mock import call, patch

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "coordinator-stage-closer.py"
SPEC = importlib.util.spec_from_file_location("coordinator_stage_closer", MODULE_PATH)
closer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(closer)


def issue(body=None, labels=None, state="OPEN"):
    return {
        "number": 900,
        "title": "Example stage",
        "state": state,
        "labels": [{"name": name} for name in (["stage:auto-close"] if labels is None else labels)],
        "body": body if body is not None else (
            "<!-- stage-status: READY_TO_CLOSE -->\n"
            "- [x] Implementation merged\n"
            "Evidence: https://github.com/necromorphic/Logic-Engine/pull/501\n"
        ),
    }


def merged_pr(checks=None):
    return {
        "number": 501,
        "state": "MERGED",
        "mergedAt": "2026-10-27T00:00:00Z",
        "headRefOid": "a" * 40,
        "statusCheckRollup": checks if checks is not None else [
            {"__typename": "CheckRun", "name": "Runtime tests", "conclusion": "SUCCESS"},
            {"__typename": "StatusContext", "context": "NPC boundary", "state": "SUCCESS"},
        ],
    }


class CoordinatorStageCloserTests(unittest.TestCase):
    def test_closes_only_when_marker_checklist_merged_pr_and_exact_head_checks_are_green(self):
        eligible, reason = closer.issue_ready(issue(), {501: merged_pr()})
        self.assertTrue(eligible, reason)

    def test_missing_opt_in_label_never_closes(self):
        eligible, reason = closer.issue_ready(issue(labels=[]), {501: merged_pr()})
        self.assertFalse(eligible)
        self.assertIn("label", reason)

    def test_missing_ready_marker_never_closes(self):
        eligible, reason = closer.issue_ready(issue(body="- [x] Done\nEvidence: https://github.com/necromorphic/Logic-Engine/pull/501"), {501: merged_pr()})
        self.assertFalse(eligible)
        self.assertIn("marker", reason)

    def test_any_unchecked_acceptance_item_blocks_closure(self):
        body = "<!-- stage-status: READY_TO_CLOSE -->\n- [x] Code merged\n- [ ] Runtime proof\nhttps://github.com/necromorphic/Logic-Engine/pull/501"
        eligible, reason = closer.issue_ready(issue(body=body), {501: merged_pr()})
        self.assertFalse(eligible)
        self.assertIn("unchecked", reason)

    def test_unmerged_pr_blocks_closure(self):
        pr = merged_pr()
        pr["mergedAt"] = None
        eligible, reason = closer.issue_ready(issue(), {501: pr})
        self.assertFalse(eligible)
        self.assertIn("not merged", reason)

    def test_missing_pending_failed_or_skipped_checks_block_closure(self):
        for checks in (None, [], [{"name": "Runtime tests", "conclusion": "FAILURE"}],
                       [{"name": "Runtime tests", "conclusion": "SKIPPED"}],
                       [{"name": "Runtime tests", "state": "SUCCESS", "conclusion": "SKIPPED"}],
                       [{"name": "Runtime tests", "state": "PENDING"}]):
            with self.subTest(checks=checks):
                self.assertFalse(closer.check_rollup_is_green(checks))

    def test_all_exact_pr_urls_must_have_evidence(self):
        body = (
            "<!-- stage-status: READY_TO_CLOSE -->\n- [x] Done\n"
            "https://github.com/necromorphic/Logic-Engine/pull/501\n"
            "https://github.com/necromorphic/Logic-Engine/pull/502\n"
        )
        eligible, reason = closer.issue_ready(issue(body=body), {501: merged_pr()})
        self.assertFalse(eligible)
        self.assertIn("incomplete", reason)

    def test_only_exact_repository_pull_urls_are_extracted(self):
        self.assertEqual(
            closer.linked_pr_numbers(
                "See #501 and https://github.com/necromorphic/Other/pull/8 "
                "and https://github.com/necromorphic/Logic-Engine/pull/502"
            ),
            [502],
        )

    def test_closed_issue_never_triggers_another_close(self):
        eligible, reason = closer.issue_ready(issue(state="CLOSED"), {501: merged_pr()})
        self.assertFalse(eligible)
        self.assertIn("not open", reason)


    def test_closes_eligible_stage_and_records_evidence_in_close_command(self):
        with patch.object(closer, "gh", side_effect=[[issue()], merged_pr(), None]) as mocked_gh:
            closed = closer.close_eligible_stages()
        self.assertEqual(closed, [900])
        close_args = mocked_gh.call_args_list[-1].args[0]
        self.assertEqual(close_args[:3], ["issue", "close", "900"])
        self.assertIn("PR #501 head " + "a" * 40, close_args[-1])
        self.assertIn("does not enable Memory→NPC", close_args[-1])

    def test_unready_stage_is_not_closed(self):
        blocked_issue = issue(body="- [x] Code merged\nhttps://github.com/necromorphic/Logic-Engine/pull/501")
        with patch.object(closer, "gh", side_effect=[[blocked_issue], merged_pr()]) as mocked_gh:
            closed = closer.close_eligible_stages()
        self.assertEqual(closed, [])
        self.assertEqual(mocked_gh.call_count, 2)
        self.assertFalse(any(args.args[0][:2] == ["issue", "close"] for args in mocked_gh.call_args_list))


if __name__ == "__main__":
    unittest.main()
