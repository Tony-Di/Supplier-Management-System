

export function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="tagRow">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}
