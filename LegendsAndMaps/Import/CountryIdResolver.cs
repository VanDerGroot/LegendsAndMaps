using System.Globalization;
using System.Text;

namespace LegendsAndMaps.Import;

public static class CountryIdResolver
{
    private static readonly Lazy<Dictionary<string, string>> NameToIso2 = new(BuildNameToIso2);

    public static string? ResolveToIso2OrIso3(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var trimmed = input.Trim();

        // If it's two letters, first try common aliases (e.g. "UK" -> "GB"),
        // then fall back to accepting it as ISO-2.
        if (IsAllLetters(trimmed) && trimmed.Length == 2)
        {
            var key2 = NormalizeName(trimmed);
            if (key2.Length > 0 && NameToIso2.Value.TryGetValue(key2, out var iso2FromAlias))
            {
                return iso2FromAlias;
            }

            return trimmed.ToUpperInvariant();
        }

        var key = NormalizeName(trimmed);
        if (key.Length == 0)
        {
            return null;
        }

        // Try resolving names (and ISO-3 codes) to ISO-2.
        if (NameToIso2.Value.TryGetValue(key, out var iso2))
        {
            return iso2;
        }

        // Fall back: treat an all-letters 3-char input as ISO-3.
        if (IsAllLetters(trimmed) && trimmed.Length == 3)
        {
            return trimmed.ToUpperInvariant();
        }

        return null;
    }

    private static Dictionary<string, string> BuildNameToIso2()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var culture in CultureInfo.GetCultures(CultureTypes.SpecificCultures))
        {
            RegionInfo region;
            try
            {
                region = new RegionInfo(culture.Name);
            }
            catch
            {
                continue;
            }

            var iso2 = region.TwoLetterISORegionName?.ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(iso2) || iso2.Length != 2)
            {
                continue;
            }

            Add(map, region.EnglishName, iso2);
            Add(map, region.DisplayName, iso2);
            Add(map, region.NativeName, iso2);

            // Also allow ISO-3 as a key (e.g. "USA").
            Add(map, region.ThreeLetterISORegionName, iso2);
        }

        // Common aliases / political names that don't round-trip via RegionInfo cultures.
        var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["united states of america"] = "US",
            ["united states"] = "US",
            ["usa"] = "US",
            ["uk"] = "GB",
            ["united kingdom"] = "GB",
            ["great britain"] = "GB",
            ["russia"] = "RU",
            ["south korea"] = "KR",
            ["north korea"] = "KP",
            ["iran"] = "IR",
            ["syria"] = "SY",
            ["vietnam"] = "VN",
            ["laos"] = "LA",
            ["bolivia"] = "BO",
            ["tanzania"] = "TZ",
            ["venezuela"] = "VE",
            ["moldova"] = "MD",
            ["czech republic"] = "CZ",
            ["czechia"] = "CZ",
            ["cape verde"] = "CV",
            ["eswatini"] = "SZ",
            ["swaziland"] = "SZ",
            ["myanmar"] = "MM",
            ["burma"] = "MM",
            ["brunei"] = "BN",
            ["ivory coast"] = "CI",
            ["cote divoire"] = "CI",
            ["cote d ivoire"] = "CI",
            ["democratic republic of the congo"] = "CD",
            ["dr congo"] = "CD",
            ["republic of the congo"] = "CG",
            ["congo republic"] = "CG",
            ["micronesia"] = "FM",
            ["palestine"] = "PS",
            ["kosovo"] = "XK",
            ["vatican city"] = "VA",
            ["holy see"] = "VA"
        };

        foreach (var (name, iso2) in aliases)
        {
            map[NormalizeName(name)] = iso2;
        }

        return map;
    }

    private static void Add(Dictionary<string, string> map, string? name, string iso2)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        var key = NormalizeName(name);
        if (key.Length == 0)
        {
            return;
        }

        // First wins; keep stable.
        map.TryAdd(key, iso2);
    }

    internal static string NormalizeName(string name)
    {
        // Normalize accents and strip punctuation to make matching forgiving.
        var normalized = name.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);

        bool lastWasSpace = false;
        foreach (var ch in normalized)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(char.ToLowerInvariant(ch));
                lastWasSpace = false;
                continue;
            }

            // Convert separators/punctuation to single spaces.
            if (!lastWasSpace)
            {
                sb.Append(' ');
                lastWasSpace = true;
            }
        }

        return sb.ToString().Trim();
    }

    private static bool IsAllLetters(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            if (!char.IsLetter(s[i]))
            {
                return false;
            }
        }
        return true;
    }
}
