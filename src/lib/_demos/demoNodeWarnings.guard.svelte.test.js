// @ts-nocheck
// Shipped examples show no unintended node warnings: shard 1 of the guard, which also checks
// that the examples are found and that every shard file exists. What it checks and why (and
// the warnings each example shows on purpose) is in demoNodeWarnings.suite.js.
import { defineDemoWarningGuard } from './demoNodeWarnings.suite.js';

defineDemoWarningGuard(0);
