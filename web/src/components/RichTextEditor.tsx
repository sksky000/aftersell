import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bold, Image as ImageIcon, Italic, List, ListOrdered, Underline } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_INLINE_IMAGE_BYTES, uploadUrl } from '@aftersell/shared';
import { Spinner } from '@/components/ui/spinner';
import { messageOf, uploadFile } from '@/lib/api';
import { htmlToText, sanitizeReplyHtml, textToHtml } from '@/lib/html';
import { cn } from '@/lib/utils';

export interface RichTextEditorHandle {
  /** 在光标处插入纯文本（快捷话术用） */
  insertText: (text: string) => void;
  focus: () => void;
}

interface Props {
  /** 初始 HTML；变化时整体替换编辑器内容（换邮件、重新生成后） */
  value: string;
  onChange: (html: string, text: string) => void;
  disabled?: boolean;
  minHeight?: number;
}

/** 在当前选区插入 HTML；选区不在编辑器里时追加到末尾 */
function insertHtmlAtCursor(editor: HTMLElement, html: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
    editor.insertAdjacentHTML('beforeend', html);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

const TOOLS = [
  { cmd: 'bold', icon: Bold, label: '加粗' },
  { cmd: 'italic', icon: Italic, label: '斜体' },
  { cmd: 'underline', icon: Underline, label: '下划线' },
  { cmd: 'insertUnorderedList', icon: List, label: '项目符号' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: '编号' },
] as const;

const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ value, onChange, disabled, minHeight = 320 }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [uploading, setUploading] = useState(0);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = sanitizeReplyHtml(value);
  }, [value]);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(editor.innerHTML, htmlToText(editor.innerHTML));
  }, [onChange]);

  const insertImage = useCallback(
    async (file: File) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (file.size > MAX_INLINE_IMAGE_BYTES) {
        toast.error('正文图片不超过 10MB，大图请作为附件');
        return;
      }
      const marker = `uploading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      insertHtmlAtCursor(editor, `<span id="${marker}" class="text-xs text-muted-foreground">［图片上传中…］</span>`);
      setUploading((n) => n + 1);
      try {
        const up = await uploadFile(file);
        const img = document.createElement('img');
        img.src = uploadUrl(up.id);
        img.alt = up.filename;
        const placeholder = editor.querySelector(`#${marker}`);
        if (placeholder) placeholder.replaceWith(img);
        else editor.appendChild(img);
      } catch (e) {
        editor.querySelector(`#${marker}`)?.remove();
        toast.error(`图片上传失败：${messageOf(e)}`);
      } finally {
        setUploading((n) => n - 1);
        emit();
      }
    },
    [emit],
  );

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    const data = event.clipboardData;
    const images = [...data.files].filter((f) => f.type.startsWith('image/'));
    event.preventDefault();
    if (images.length) {
      for (const f of images) void insertImage(f);
      return;
    }
    // 粘贴的格式统一清洗：去脚本、样式、外链图片
    const html = data.getData('text/html');
    insertHtmlAtCursor(editor, html ? sanitizeReplyHtml(html) : textToHtml(data.getData('text/plain')));
    emit();
  };

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        insertHtmlAtCursor(editor, textToHtml(text));
        emit();
      },
      focus: () => editorRef.current?.focus(),
    }),
    [emit],
  );

  return (
    <div className={cn('rounded-md border border-border', disabled && 'opacity-70')}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            title={t.label}
            disabled={disabled}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-50"
            onMouseDown={(e) => {
              e.preventDefault(); // 不让按钮抢走编辑器选区
              document.execCommand(t.cmd);
              emit();
            }}
          >
            <t.icon className="size-4" />
          </button>
        ))}
        <label className={cn('p-1.5 rounded hover:bg-muted cursor-pointer', disabled && 'pointer-events-none opacity-50')} title="插入图片">
          <ImageIcon className="size-4" />
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                editorRef.current?.focus();
                void insertImage(file);
              }
            }}
          />
        </label>
        <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
          {uploading > 0 ? (
            <>
              <Spinner className="size-3" /> 图片上传中
            </>
          ) : (
            '可直接 Ctrl+V 粘贴图片'
          )}
        </span>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onPaste={onPaste}
        onInput={() => !composing.current && emit()}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          emit();
        }}
        className="px-4 py-3 text-sm leading-relaxed outline-none overflow-y-auto break-words [&_img]:max-w-full [&_img]:max-h-80 [&_img]:my-2 [&_img]:rounded [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        style={{ minHeight }}
      />
    </div>
  );
});

export default RichTextEditor;
