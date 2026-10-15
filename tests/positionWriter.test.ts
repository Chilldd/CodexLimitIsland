import { expect, test, vi } from "vitest";
import { createPositionWriter } from "../src/positionWriter";
import { deferred, flush } from "./fixtures";
test("100 slow native targets keep a single in-flight request and deliver the latest position", async () => {
  const first = deferred();
  const second = deferred();
  const move = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const report = vi.fn();
  const writer = createPositionWriter(move, report);
  for (let x = 0; x < 100; x++) writer.move(x, 3);
  expect(move.mock.calls).toEqual([[0, 3]]);
  first.resolve();
  await flush();
  expect(move.mock.calls).toEqual([
    [0, 3],
    [99, 3],
  ]);
  second.resolve();
  await flush();
  writer.move(99, 3);
  expect(move).toHaveBeenCalledTimes(2);
  expect(report).not.toHaveBeenCalled();
});
test("native rejection is visible, pending work recovers and unmount drops the latest target", async () => {
  const first = deferred();
  const move = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const report = vi.fn();
  const writer = createPositionWriter(move, report);
  writer.move(1, 3);
  writer.move(2, 3);
  first.reject(new Error("failure"));
  await flush();
  expect(report).toHaveBeenCalledOnce();
  expect(move).toHaveBeenLastCalledWith(2, 3);
  await flush();
  writer.dispose();
  writer.move(3, 3);
  expect(move).toHaveBeenCalledTimes(2);
  writer.activate();
  writer.move(4, 3);
  await flush();
  expect(move).toHaveBeenLastCalledWith(4, 3);
});
test("cleanup while native work is pending schedules no trailing movement", async () => {
  const first = deferred();
  const move = vi.fn().mockReturnValue(first.promise);
  const writer = createPositionWriter(move, vi.fn());
  writer.move(1, 3);
  writer.move(2, 3);
  writer.dispose();
  first.resolve();
  await flush();
  expect(move).toHaveBeenCalledOnce();
});
