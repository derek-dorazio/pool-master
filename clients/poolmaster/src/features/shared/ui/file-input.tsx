import {
  forwardRef,
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { cn } from "./class-names";

export type FileInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value"
> & {
  /**
   * Called with the first selected file's text contents. When supplied, the
   * component reads the file with a `FileReader` and hands back the string; the
   * caller never touches the raw `File` unless it also passes `onChange`.
   */
  onFileText?: (text: string, file: File) => void;
};

/**
 * Shared file-picker primitive. `rules/react-ui-rules.md` §5 bars bare
 * `<input type="file">` in feature code; the golf-admin bulk-upload panels
 * (plans/124 §6.3/§6.4 — league roster, round scores) are the first consumers.
 */
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
  function FileInput({ className, onChange, onFileText, ...props }, ref) {
    const generatedId = useId();
    const fieldId = props.id ?? generatedId;
    const readerRef = useRef<FileReader | null>(null);

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      onChange?.(event);

      const file = event.target.files?.[0];
      if (!file || !onFileText) {
        return;
      }

      readerRef.current?.abort();
      const reader = new FileReader();
      readerRef.current = reader;
      reader.addEventListener("load", () => {
        onFileText(String(reader.result ?? ""), file);
      });
      reader.readAsText(file);
    }

    return (
      <input
        className={cn(
          "block w-full cursor-pointer rounded-2xl border border-border bg-background text-sm text-foreground outline-none transition file:mr-4 file:cursor-pointer file:border-0 file:bg-muted file:px-4 file:py-3 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80 focus:border-primary disabled:cursor-not-allowed disabled:opacity-70",
          className,
        )}
        id={fieldId}
        onChange={handleChange}
        ref={ref}
        type="file"
        {...props}
      />
    );
  },
);
