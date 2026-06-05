// The canonical "drill" logo mark: a rounded ink tile holding a Fraunces "d"
// with a terracotta bar beneath it. Mirrors assets/favicon.svg so the in-app
// logo and the browser favicon read as the same mark. Inner pieces are sized in
// `em` so the whole mark scales from the tile's font-size (== its px size).
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-[7px] bg-ink text-paper"
      style={{ width: size, height: size, fontSize: size }}
    >
      <span className="flex flex-col items-center leading-none">
        <span
          className="font-display font-medium leading-none"
          style={{ fontSize: '0.58em' }}
        >
          d
        </span>
        <span
          className="bg-accent rounded-[1px]"
          style={{
            width: '0.42em',
            height: '0.085em',
            minHeight: 2,
            marginTop: '0.06em',
          }}
        />
      </span>
    </span>
  );
}
