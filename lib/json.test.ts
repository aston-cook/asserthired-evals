import { describe, it, expect } from 'vitest';
import { extractJson } from './json.js';

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses clean JSON arrays', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON inside a ```json fence', () => {
    const input = '```json\n{"pass":true,"violations":[]}\n```';
    expect(extractJson(input)).toEqual({ pass: true, violations: [] });
  });

  it('parses JSON inside a plain ``` fence', () => {
    const input = '```\n{"score":80}\n```';
    expect(extractJson(input)).toEqual({ score: 80 });
  });

  it('parses JSON with leading prose', () => {
    const input = 'Here is the JSON you asked for: {"a":1,"b":2}';
    expect(extractJson(input)).toEqual({ a: 1, b: 2 });
  });

  it('parses JSON with trailing prose', () => {
    const input = '{"a":1}\n\nLet me know if you have questions.';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it('parses JSON with leading and trailing prose', () => {
    const input = 'Sure, here it is: {"score":70,"feedback":"ok"} End of response.';
    expect(extractJson(input)).toEqual({ score: 70, feedback: 'ok' });
  });

  it('returns null on malformed input', () => {
    expect(extractJson('not json at all')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('   ')).toBeNull();
  });

  it('returns null when fence contains invalid JSON', () => {
    expect(extractJson('```json\nnot actually json\n```')).toBeNull();
  });

  it('handles nested objects in prose context', () => {
    const input = 'Response: {"outer":{"inner":"value"}}';
    expect(extractJson(input)).toEqual({ outer: { inner: 'value' } });
  });
});
