import { useEffect, useRef, useState } from "react";
import { Input } from "../../shared/design-system/ui/Input";
import { InputGroup } from "../../shared/design-system/ui/InputGroup";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import { compactAt, MIN_COMPACT_AT } from "./compact-at";

const shown = (value: string | undefined) => {
  const tokens = compactAt(value);
  return tokens ? String(tokens / 1000) : "";
};

/** Thousands typed in the field as stored tokens: "" when blank, undefined
 * when invalid. */
const parse = (text: string) => {
  const k = text.trim();
  if (!k) return "";
  const tokens = /^\d+$/.test(k) ? String(Number(k) * 1000) : "";
  return compactAt(tokens) ? tokens : undefined;
};

const INVALID = `Enter a whole number of at least ${MIN_COMPACT_AT / 1000}K, or leave it blank for the model default.`;

/** When the agent's session compacts its context: a size in thousands of
 * tokens, or blank for the model's own default. Only valid sizes reach
 * `onChange`; anything else keeps its error and stops its form submitting. */
export function CompactionField({
  value,
  description = "Compacts at this many tokens, or sooner if the model's context window is smaller.",
  disabled = false,
  onChange,
}: {
  value: string | undefined;
  description?: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [text, setText] = useState(shown(value));
  useEffect(() => setText(shown(value)), [value]);
  const valid = parse(text) !== undefined;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.setCustomValidity(valid ? "" : INVALID));
  return (
    <>
      <PreferenceRow
        title="Auto-compact at"
        subtitle={description}
        trailing={(label) => (
          <div className="w-40">
            <InputGroup
              surface="panel"
              trailing={
                text.trim() ? <span aria-hidden="true">K</span> : undefined
              }
            >
              <Input
                {...label}
                ref={input}
                aria-invalid={!valid || undefined}
                inputMode="numeric"
                placeholder="Model default"
                value={text}
                disabled={disabled}
                onChange={(event) => {
                  setText(event.target.value);
                  const tokens = parse(event.target.value);
                  if (tokens !== undefined) onChange(tokens);
                }}
                onBlur={() => valid && setText(shown(value))}
              />
            </InputGroup>
          </div>
        )}
      />
      {!valid && (
        <p role="alert" className="buzz-field-error">
          {INVALID}
        </p>
      )}
    </>
  );
}
