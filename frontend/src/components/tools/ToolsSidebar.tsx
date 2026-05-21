interface Props {
  selected: string;
  onSelect: (category: string) => void;
}

export default function ToolsSidebar({ selected, onSelect }: Props) {
  const categories = ["All", "Web Tools", "Web Security", "Network", "Blue Team"];

  return (
    <aside>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          style={{
            fontWeight: selected === cat ? "bold" : "normal",
          }}
        >
          {cat}
        </button>
      ))}
    </aside>
  );
}
