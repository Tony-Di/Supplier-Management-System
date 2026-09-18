

export function SubTabs({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: string;
  onChange: (tab: string) => void;
  tabs: string[];
}) {
  return (
    <div className="subTabs" role="tablist">
      {tabs.map((tab) => (
        <button
          className={tab === activeTab ? "subTab active" : "subTab"}
          key={tab}
          onClick={() => onChange(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
