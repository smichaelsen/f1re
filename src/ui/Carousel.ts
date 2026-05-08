import Phaser from "phaser";

export interface CarouselItem {
  id: string;
}

export interface CarouselOptions<T extends CarouselItem> {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  items: readonly T[];
  initialId?: string;
  onChange?: (item: T) => void;
  renderItem: (scene: Phaser.Scene, container: Phaser.GameObjects.Container, item: T) => void;
}

const ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "36px",
  color: "#dddddd",
  backgroundColor: "#2a2a2a",
  padding: { x: 16, y: 4 },
  fontStyle: "bold",
};

const COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#888888",
};

export class Carousel<T extends CarouselItem> {
  readonly container: Phaser.GameObjects.Container;
  private idx = 0;
  private content: Phaser.GameObjects.Container;
  private indicator: Phaser.GameObjects.Text;
  private prevBtn: Phaser.GameObjects.Text;
  private nextBtn: Phaser.GameObjects.Text;

  constructor(private opts: CarouselOptions<T>) {
    if (opts.items.length === 0) throw new Error("Carousel requires at least one item");
    if (opts.initialId) {
      const i = opts.items.findIndex((x) => x.id === opts.initialId);
      if (i >= 0) this.idx = i;
    }
    const s = opts.scene;
    const halfW = opts.width / 2;

    this.container = s.add.container(opts.x, opts.y);

    this.prevBtn = s.add
      .text(-halfW, 0, "‹", ARROW_STYLE)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.nextBtn = s.add
      .text(halfW, 0, "›", ARROW_STYLE)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.prevBtn.on("pointerdown", () => this.step(-1));
    this.nextBtn.on("pointerdown", () => this.step(+1));
    this.prevBtn.on("pointerover", () => this.prevBtn.setStyle({ color: "#ffffff", backgroundColor: "#404040" }));
    this.prevBtn.on("pointerout", () => this.prevBtn.setStyle({ color: "#dddddd", backgroundColor: "#2a2a2a" }));
    this.nextBtn.on("pointerover", () => this.nextBtn.setStyle({ color: "#ffffff", backgroundColor: "#404040" }));
    this.nextBtn.on("pointerout", () => this.nextBtn.setStyle({ color: "#dddddd", backgroundColor: "#2a2a2a" }));

    this.content = s.add.container(0, 0);
    this.indicator = s.add.text(0, 56, "", COUNT_STYLE).setOrigin(0.5);

    this.container.add([this.prevBtn, this.nextBtn, this.content, this.indicator]);
    this.refresh(false);
  }

  current(): T {
    return this.opts.items[this.idx];
  }

  setCurrent(id: string): void {
    const i = this.opts.items.findIndex((x) => x.id === id);
    if (i >= 0 && i !== this.idx) {
      this.idx = i;
      this.refresh(true);
    }
  }

  step(delta: number): void {
    const n = this.opts.items.length;
    this.idx = (this.idx + delta + n) % n;
    this.refresh(true);
  }

  destroy(): void {
    this.container.destroy();
  }

  private refresh(emit: boolean): void {
    this.content.removeAll(true);
    this.opts.renderItem(this.opts.scene, this.content, this.current());
    this.indicator.setText(`${this.idx + 1} / ${this.opts.items.length}`);
    if (emit) this.opts.onChange?.(this.current());
  }
}
