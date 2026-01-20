using System.Collections.Concurrent;
using LegendsAndMaps.State;

namespace LegendsAndMaps.Services;

public sealed class InMemoryMapStateService : IMapStateService
{
    private static readonly Guid NoDataSetId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private readonly object _gate = new();
    private readonly List<CountrySet> _sets = new();

    private readonly IReadOnlyCollection<string> _allCountryIds;

    // Country id (e.g. "GB", "US") -> set id
    private readonly ConcurrentDictionary<string, Guid> _countryToSet = new(StringComparer.OrdinalIgnoreCase);

    public event Action? StateChanged;

    public Guid DefaultSetId => NoDataSetId;
    public int TotalCountryCount => _allCountryIds.Count;

    public InMemoryMapStateService(CountryCatalog catalog)
    {
        _allCountryIds = catalog.CountryIds;

        // Always keep the default group.
        _sets.Add(new CountrySet(NoDataSetId, "No data", "#e9ecef"));
    }

    public IReadOnlyList<CountrySet> GetSets()
    {
        lock (_gate)
        {
            return _sets.ToList();
        }
    }

    public CountrySet AddSet(string name, string colorHex)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Set name is required.", nameof(name));
        }

        var normalizedColor = NormalizeColor(colorHex);
        var created = new CountrySet(Guid.NewGuid(), name.Trim(), normalizedColor);

        lock (_gate)
        {
            _sets.Add(created);
        }

        StateChanged?.Invoke();
        return created;
    }

    public void UpdateSet(Guid setId, string name, string colorHex)
    {
        if (setId == Guid.Empty)
        {
            throw new ArgumentException("Set id is required.", nameof(setId));
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Set name is required.", nameof(name));
        }

        var normalizedColor = NormalizeColor(colorHex);

        lock (_gate)
        {
            var index = _sets.FindIndex(s => s.Id == setId);
            if (index < 0)
            {
                return;
            }

            if (setId == NoDataSetId)
            {
                // Keep the default group's name stable.
                _sets[index] = _sets[index] with { ColorHex = normalizedColor };
            }
            else
            {
                _sets[index] = _sets[index] with { Name = name.Trim(), ColorHex = normalizedColor };
            }
        }

        StateChanged?.Invoke();
    }

    public void RemoveSet(Guid setId)
    {
        if (setId == Guid.Empty)
        {
            return;
        }

        if (setId == NoDataSetId)
        {
            return;
        }

        bool removed;
        lock (_gate)
        {
            removed = _sets.RemoveAll(s => s.Id == setId) > 0;
        }

        if (!removed)
        {
            return;
        }

        foreach (var kvp in _countryToSet.ToArray())
        {
            if (kvp.Value == setId)
            {
                _countryToSet.TryRemove(kvp.Key, out _);
            }
        }

        StateChanged?.Invoke();
    }

    public Guid? GetAssignedSetId(string countryId)
    {
        if (string.IsNullOrWhiteSpace(countryId))
        {
            return null;
        }

        return _countryToSet.TryGetValue(countryId.Trim(), out var setId) ? setId : NoDataSetId;
    }

    public void AssignCountryToSet(string countryId, Guid? setId)
    {
        if (string.IsNullOrWhiteSpace(countryId))
        {
            return;
        }

        var normalizedCountryId = countryId.Trim().ToUpperInvariant();

        if (setId is null || setId == Guid.Empty || setId == NoDataSetId)
        {
            _countryToSet.TryRemove(normalizedCountryId, out _);
            StateChanged?.Invoke();
            return;
        }

        // Ignore unknown set ids.
        lock (_gate)
        {
            if (_sets.All(s => s.Id != setId.Value))
            {
                return;
            }
        }

        _countryToSet[normalizedCountryId] = setId.Value;
        StateChanged?.Invoke();
    }

    public IReadOnlyDictionary<string, Guid> GetCountryAssignments()
    {
        // Return a full snapshot where every known country maps to a set id.
        var result = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in _allCountryIds)
        {
            result[id] = NoDataSetId;
        }

        foreach (var (countryId, setId) in _countryToSet)
        {
            result[countryId] = setId;
        }

        return result;
    }

    public void ReplaceAll(IReadOnlyList<CountrySet> sets, IReadOnlyDictionary<string, Guid> countryAssignments)
    {
        sets ??= Array.Empty<CountrySet>();
        countryAssignments ??= new Dictionary<string, Guid>();

        // Preserve/ensure the default set and optionally allow imports to override its color.
        string? importedNoDataColor = null;
        var importedNoDataIds = new HashSet<Guid>();

        var filteredSets = new List<CountrySet>();
        foreach (var s in sets)
        {
            if (string.Equals(s.Name, "No data", StringComparison.OrdinalIgnoreCase))
            {
                importedNoDataColor = s.ColorHex;
                importedNoDataIds.Add(s.Id);
                continue;
            }

            if (s.Id == NoDataSetId)
            {
                importedNoDataColor = s.ColorHex;
                continue;
            }

            filteredSets.Add(s with { ColorHex = NormalizeColor(s.ColorHex) });
        }

        var validSetIds = new HashSet<Guid>(filteredSets.Select(s => s.Id))
        {
            NoDataSetId
        };

        lock (_gate)
        {
            _sets.Clear();

            var noDataColor = NormalizeColor(importedNoDataColor ?? "#e9ecef");
            _sets.Add(new CountrySet(NoDataSetId, "No data", noDataColor));
            _sets.AddRange(filteredSets);
        }

        _countryToSet.Clear();
        foreach (var kvp in countryAssignments)
        {
            if (string.IsNullOrWhiteSpace(kvp.Key))
            {
                continue;
            }

            var assignedSetId = kvp.Value;
            if (importedNoDataIds.Contains(assignedSetId))
            {
                assignedSetId = NoDataSetId;
            }

            if (!validSetIds.Contains(assignedSetId))
            {
                continue;
            }

            if (assignedSetId == NoDataSetId)
            {
                continue;
            }

            _countryToSet[kvp.Key.Trim().ToUpperInvariant()] = assignedSetId;
        }

        StateChanged?.Invoke();
    }

    public IReadOnlyDictionary<string, string> GetCountryColorsById()
    {
        Dictionary<Guid, string> setColors;
        lock (_gate)
        {
            setColors = _sets.ToDictionary(s => s.Id, s => s.ColorHex);
        }

        // Default every known country to the No data color.
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (setColors.TryGetValue(NoDataSetId, out var noDataColor))
        {
            foreach (var id in _allCountryIds)
            {
                result[id] = noDataColor;
            }
        }
        foreach (var (countryId, setId) in _countryToSet)
        {
            if (setColors.TryGetValue(setId, out var color))
            {
                result[countryId] = color;
            }
        }

        return result;
    }

    private static string NormalizeColor(string color)
    {
        if (string.IsNullOrWhiteSpace(color))
        {
            return "#808080";
        }

        var c = color.Trim();

        // If user entered a raw hex value without '#', normalize it.
        // Otherwise, allow any CSS color keyword (e.g. "red", "rebeccapurple")
        // and let the browser decide if it is valid.
        if (!c.StartsWith('#'))
        {
            var isHex = c.Length is 3 or 6;
            if (isHex)
            {
                for (var i = 0; i < c.Length; i++)
                {
                    if (!Uri.IsHexDigit(c[i]))
                    {
                        isHex = false;
                        break;
                    }
                }
            }

            if (isHex)
            {
                return "#" + c;
            }

            return c;
        }

        // Best-effort validation of #RGB / #RRGGBB. If it doesn't match, keep it,
        // and rely on the browser to reject invalid CSS colors.
        if (c.Length is 4 or 7)
        {
            for (var i = 1; i < c.Length; i++)
            {
                if (!Uri.IsHexDigit(c[i]))
                {
                    return "#808080";
                }
            }
            return c;
        }

        return c;
    }
}
