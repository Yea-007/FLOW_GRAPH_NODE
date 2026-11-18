import { useLayoutEffect, useRef, useState } from "react";
import { getErrorMessage } from "./api";
import type { NoteIcon } from "./types";

const emojiGroups = [
  {
    name: "常用",
    icons: [
      ["📝", "备忘"], ["📁", "文件夹"], ["📄", "文档"], ["⭐", "星标"],
      ["📌", "图钉"], ["✅", "完成"], ["💡", "灵感"], ["🎯", "目标"],
      ["📅", "日历"], ["🔖", "书签"], ["📎", "附件"], ["🔍", "搜索"],
      ["🚀", "火箭"], ["🔥", "热门"], ["🎉", "庆祝"], ["❤️", "收藏"],
    ],
  },
  {
    name: "学习",
    icons: [
      ["📚", "书籍"], ["📖", "阅读"], ["🎓", "毕业"], ["🏫", "学校"],
      ["✏️", "铅笔"], ["📐", "三角尺"], ["🧮", "计算"], ["🧪", "实验"],
      ["🔬", "显微镜"], ["⚡", "闪电"], ["🔋", "电池"], ["💻", "电脑"],
      ["🧠", "思考"], ["🧩", "拼图"], ["🌐", "网络"], ["🌏", "地球"],
    ],
  },
  {
    name: "工作",
    icons: [
      ["💼", "公文包"], ["🗂️", "分类"], ["📋", "任务清单"], ["📊", "图表"],
      ["📈", "趋势"], ["🧾", "收据"], ["📦", "包裹"], ["🏷️", "标签"],
      ["🛠️", "工具"], ["⚙️", "设置"], ["💬", "讨论"], ["📣", "公告"],
      ["🤝", "合作"], ["🔒", "锁定"], ["⏰", "提醒"], ["🏆", "奖杯"],
    ],
  },
  {
    name: "生活",
    icons: [
      ["🌸", "樱花"], ["🌿", "绿叶"], ["🌻", "向日葵"], ["🍀", "四叶草"],
      ["☀️", "太阳"], ["🌙", "月亮"], ["🌈", "彩虹"], ["☕", "咖啡"],
      ["🍵", "茶"], ["🍰", "蛋糕"], ["🎨", "画画"], ["🎵", "音乐"],
      ["📷", "拍照"], ["🐱", "猫"], ["🐶", "狗"], ["✈️", "旅行"],
    ],
  },
] as const;

const singleEmoji = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*[\u{E0020}-\u{E007F}]*)$/u;
const iconSize = 48;
const imageTypes = ["image/png", "image/jpeg", "image/webp"];

async function loadImageIcon(file: File): Promise<NoteIcon> {
  if (!imageTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("请选择 5 MB 以内的 PNG、JPEG 或 WebP 图片。");
  }
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("无法读取这张图片，请选择另一张。");
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = iconSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成图片图标。");
    const scale = iconSize / Math.max(image.width, image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (iconSize - width) / 2, (iconSize - height) / 2, width, height);
    const value = canvas.toDataURL("image/png").split(",")[1];
    return { type: "image", value };
  } finally {
    image.close();
  }
}

export interface NoteIconAnchor {
  left: number;
  top: number;
  bottom: number;
}

interface NoteIconPickerProps {
  anchor: NoteIconAnchor;
  title: string;
  icon?: NoteIcon | null;
  onClose: () => void;
  onSave: (icon: NoteIcon | null) => Promise<void>;
}

export function NoteIconPicker({ anchor, title, icon, onClose, onSave }: NoteIconPickerProps) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [customEmoji, setCustomEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (!popover.matches(":popover-open")) popover.showPopover();

    function placePopover() {
      if (!popover) return;
      const { width, height } = popover.getBoundingClientRect();
      const top = anchor.bottom + 6 + height > window.innerHeight
        ? anchor.top - height - 6
        : anchor.bottom + 6;
      popover.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
      popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    }

    placePopover();
    popover.focus({ preventScroll: true });
    window.addEventListener("resize", placePopover);
    const observer = new ResizeObserver(placePopover);
    observer.observe(popover);
    return () => {
      window.removeEventListener("resize", placePopover);
      observer.disconnect();
    };
  }, [anchor]);

  async function saveIcon(next: NoteIcon | null | File) {
    setSaving(true);
    setError(null);
    try {
      await onSave(next instanceof File ? await loadImageIcon(next) : next);
      if (popoverRef.current?.matches(":popover-open")) popoverRef.current.hidePopover();
    } catch (failure) {
      setError(getErrorMessage(failure));
      setSaving(false);
    }
  }

  return (
    <div
      ref={popoverRef}
      popover="auto"
      role="dialog"
      tabIndex={-1}
      aria-label={`更换图标 · ${title}`}
      onToggle={(event) => { if (event.newState === "closed") onClose(); }}
      className="fixed inset-auto m-0 max-h-[calc(100dvh-16px)] w-[296px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-paper-deep bg-cloud p-3 font-body text-ink shadow-xl outline-none"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <h2 className="shrink-0 text-[13px] font-semibold">更换图标</h2>
        <span className="truncate text-[11px] text-ink-ghost">{title}</span>
      </div>

      <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0 disabled:opacity-60">
        <div role="group" aria-label="图标分类" className="flex gap-0.5 rounded-lg bg-paper-warm/60 p-0.5">
          {emojiGroups.map((group, index) => (
            <button
              type="button"
              key={group.name}
              aria-pressed={index === groupIndex}
              onClick={() => setGroupIndex(index)}
              className={`flex-1 cursor-pointer rounded-md py-1 text-[11px] ${
                index === groupIndex ? "bg-cloud font-semibold text-bamboo shadow-sm" : "text-ink-faint hover:text-bamboo"
              }`}
            >
              {group.name}
            </button>
          ))}
        </div>

        <div className="my-2 grid grid-cols-8 gap-0.5">
          {emojiGroups[groupIndex].icons.map(([emoji, label]) => (
            <button
              type="button"
              key={emoji}
              aria-label={label}
              title={label}
              aria-pressed={icon?.type === "emoji" && icon.value === emoji}
              onClick={() => void saveIcon({ type: "emoji", value: emoji })}
              className="aspect-square cursor-pointer rounded-md text-[18px] leading-none hover:bg-bamboo-mist aria-pressed:bg-bamboo-mist aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-bamboo/50"
            >
              {emoji}
            </button>
          ))}
        </div>

        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = customEmoji.trim();
            if (!singleEmoji.test(value)) {
              setError("请输入一个表情符号。");
              return;
            }
            void saveIcon({ type: "emoji", value });
          }}
        >
          <input
            aria-label="自定义表情"
            placeholder="粘贴表情或按 Win + ."
            value={customEmoji}
            onChange={(event) => { setCustomEmoji(event.target.value); setError(null); }}
            maxLength={40}
            className="min-w-0 flex-1 rounded-md bg-paper-warm/60 px-2 py-1.5 text-[12px] focus:ring-1 focus:ring-bamboo/60"
          />
          <button type="submit" disabled={!customEmoji.trim()} className="cursor-pointer rounded-md bg-bamboo-mist px-2.5 text-[11px] font-medium text-bamboo hover:bg-bamboo/15 disabled:cursor-default disabled:opacity-50">
            应用
          </button>
        </form>

        <div className="mt-2 flex items-center justify-between border-t border-paper-deep/70 pt-2 text-[11px]">
          <button type="button" onClick={() => fileRef.current?.click()} className="cursor-pointer rounded px-1 py-0.5 text-bamboo hover:bg-bamboo-mist">
            上传图片
          </button>
          <button type="button" disabled={!icon} onClick={() => void saveIcon(null)} className="cursor-pointer rounded px-1 py-0.5 text-ink-faint hover:bg-paper-warm disabled:cursor-default disabled:opacity-50">
            恢复默认
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={imageTypes.join(",")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void saveIcon(file);
          }}
        />
      </fieldset>
      {error && <p role="alert" className="mt-2 px-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
