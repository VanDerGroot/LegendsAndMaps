using LegendsAndMaps.State;

namespace LegendsAndMaps.Services;

public interface IMapStateService
{
    event Action? StateChanged;

    Guid DefaultSetId { get; }
    int TotalCountryCount { get; }

    IReadOnlyList<CountrySet> GetSets();
    CountrySet AddSet(string name, string colorHex);
    void UpdateSet(Guid setId, string name, string colorHex);
    void RemoveSet(Guid setId);

    Guid? GetAssignedSetId(string countryId);
    void AssignCountryToSet(string countryId, Guid? setId);

    IReadOnlyDictionary<string, Guid> GetCountryAssignments();

    void ReplaceAll(IReadOnlyList<CountrySet> sets, IReadOnlyDictionary<string, Guid> countryAssignments);

    IReadOnlyDictionary<string, string> GetCountryColorsById();
}
